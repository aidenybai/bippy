/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/Environment.ts at b618bbb.

import {
  CompilerDiagnostic,
  CompilerError,
  type CompilerErrorDetail,
  ErrorCategory,
} from "../compiler-error.js";
import { assertExhaustive } from "../utils/utils.js";
import { DEFAULT_GLOBALS, DEFAULT_SHAPES, type Global, type GlobalRegistry } from "./globals.js";
import {
  type BlockId,
  type BuiltInType,
  Effect,
  type FunctionType,
  GeneratedSource,
  type IdentifierId,
  type NonLocalBinding,
  type PolyType,
  type Type,
  ValueKind,
  type ScopeId,
  makeBlockId,
  makeIdentifierId,
  makeScopeId,
} from "./hir.js";
import {
  BuiltInMixedReadonlyId,
  DefaultMutatingHook,
  DefaultNonmutatingHook,
  type FunctionSignature,
  type ShapeRegistry,
  addHook,
} from "./object-shape.js";
import type { FunctionNode, IdentifierNode, ScopeManager } from "./scope.js";

export interface Hook {
  /*
   * The effect of arguments to this hook. Describes whether the hook may or may
   * not mutate arguments, etc.
   */
  effectKind: Effect;

  /*
   * The kind of value returned by the hook. Allows indicating that a hook returns
   * a primitive or already-frozen value, which can allow more precise memoization
   * of callers.
   */
  valueKind: ValueKind;

  /*
   * Specifies whether hook arguments may be aliased by other arguments or by the
   * return value of the function. Defaults to false. When enabled, this allows the
   * compiler to avoid memoizing arguments.
   */
  noAlias: boolean;

  /*
   * Specifies whether the hook returns data that is composed of:
   * - undefined
   * - null
   * - boolean
   * - number
   * - string
   * - arrays whose items are also transitiveMixed
   * - objects whose values are also transitiveMixed
   *
   * Many state management and data-fetching APIs return data that meets
   * this criteria since this is JSON + undefined. Forget can compile
   * hooks that return transitively mixed data more optimally because it
   * can make inferences about some method calls (especially array methods
   * like `data.items.map(...)` since these builtin types have few built-in
   * methods.
   */
  transitiveMixedData: boolean;
}

export interface EnvironmentConfig {
  customHooks: Map<string, Hook>;

  enableAssumeHooksFollowRulesOfReact: boolean;

  /**
   * If enabled, this will treat objects named as `ref` or if their names end with the substring `Ref`,
   * and contain a property named `current`, as React refs.
   *
   * ```
   * const ref = useMyRef();
   * const myRef = useMyRef2();
   * useEffect(() => {
   *   ref.current = ...;
   *   myRef.current = ...;
   * })
   * ```
   *
   * Here the variables `ref` and `myRef` will be typed as Refs.
   */
  enableTreatRefLikeIdentifiersAsRefs: boolean;

  /**
   * Treat identifiers as SetState type if both
   * - they are named with a "set-" prefix
   * - they are called somewhere
   */
  enableTreatSetIdentifiersAsStateSetters: boolean;

  /**
   * Enable using information from existing useMemo/useCallback to understand when a value is done
   * being mutated. With this mode enabled, Forget will still discard the actual useMemo/useCallback
   * calls and may memoize slightly differently. However, it will assume that the values produced
   * are not subsequently modified, guaranteeing that the value will be memoized.
   *
   * By preserving guarantees about when values are memoized, this option preserves any existing
   * behavior that depends on referential equality in the original program. Notably, this preserves
   * existing effect behavior (how often effects fire) for effects that rely on referential equality.
   *
   * When disabled, Forget will not only prune useMemo and useCallback calls but also completely ignore
   * them, not using any information from them to guide compilation. Therefore, disabling this flag
   * will produce output that mimics the result from removing all memoization.
   *
   * Our recommendation is to first try running your application with this flag enabled, then attempt
   * to disable this flag and see what changes or breaks. This will mostly likely be effects that
   * depend on referential equality, which can be refactored (TODO guide for this).
   *
   * NOTE: this mode treats freeze as a transitive operation for function expressions. This means
   * that if a useEffect or useCallback references a function value, that function value will be
   * considered frozen, and in turn all of its referenced variables will be considered frozen as well.
   */
  enablePreserveExistingMemoizationGuarantees: boolean;

  /**
   * Validates that all useMemo/useCallback values are also memoized by Forget. This mode can be
   * used with or without @enablePreserveExistingMemoizationGuarantees.
   *
   * With enablePreserveExistingMemoizationGuarantees, this validation enables automatically and
   * verifies that Forget was able to preserve manual memoization semantics under that mode's
   * additional assumptions about the input.
   *
   * With enablePreserveExistingMemoizationGuarantees off, this validation ignores manual memoization
   * when determining program behavior, and only uses information from useMemo/useCallback to check
   * that the memoization was preserved. This can be useful for determining where referential equalities
   * may change under Forget.
   */
  validatePreserveExistingMemoizationGuarantees: boolean;

  // 🌲
  enableForest: boolean;

  /*
   * Validates that setState is not unconditionally called during render, as it can lead to
   * infinite loops.
   */
  validateNoSetStateInRender: boolean;

  /**
   * Validate against impure functions called during render
   */
  validateNoImpureFunctionsInRender: boolean;

  /**
   * When enabled, the compiler assumes that any values are not subsequently
   * modified after they are captured by a function passed to React. For example,
   * if a value `x` is referenced inside a function expression passed to `useEffect`,
   * then this flag will assume that `x` is not subusequently modified.
   */
  enableTransitivelyFreezeFunctionExpressions: boolean;
}

export type PartialEnvironmentConfig = Partial<EnvironmentConfig>;

export type ReactFunctionType = "Component" | "Hook" | "Other";

export type CompilerOutputMode =
  // Build optimized for SSR, with client features removed
  | "ssr"
  // Build optimized for the client, with auto memoization
  | "client"
  // Lint mode, the output is unused but validations should run
  | "lint";

export const printFunctionType = (type: ReactFunctionType): string => {
  switch (type) {
    case "Component": {
      return "component";
    }
    case "Hook": {
      return "hook";
    }
    default: {
      return "function";
    }
  }
};

export class Environment {
  #globals: GlobalRegistry;
  #shapes: ShapeRegistry;
  #nextIdentifer: number = 0;
  #nextBlock: number = 0;
  #nextScope: number = 0;
  scopes: ScopeManager;
  config: EnvironmentConfig;
  fnType: ReactFunctionType;
  outputMode: CompilerOutputMode;

  #contextIdentifiers: Set<IdentifierNode>;
  #hoistedIdentifiers: Set<IdentifierNode>;
  parentFunction: FunctionNode;

  /**
   * Accumulated compilation errors. Passes record errors here instead of
   * throwing, so the pipeline can continue and report all errors at once.
   */
  #errors: CompilerError = new CompilerError();

  constructor(
    scopes: ScopeManager,
    fnType: ReactFunctionType,
    outputMode: CompilerOutputMode,
    config: EnvironmentConfig,
    contextIdentifiers: Set<IdentifierNode>,
    parentFunction: FunctionNode, // the outermost function being compiled
  ) {
    this.scopes = scopes;
    this.fnType = fnType;
    this.outputMode = outputMode;
    this.config = config;
    this.#shapes = new Map(DEFAULT_SHAPES);
    this.#globals = new Map(DEFAULT_GLOBALS);

    for (const [hookName, hook] of this.config.customHooks) {
      CompilerError.invariant(!this.#globals.has(hookName), {
        reason: `[Globals] Found existing definition in global registry for custom hook ${hookName}`,
        loc: GeneratedSource,
      });
      this.#globals.set(
        hookName,
        addHook(this.#shapes, {
          positionalParams: [],
          restParam: hook.effectKind,
          returnType: hook.transitiveMixedData
            ? { kind: "Object", shapeId: BuiltInMixedReadonlyId }
            : { kind: "Poly" },
          returnValueKind: hook.valueKind,
          calleeEffect: Effect.Read,
          hookKind: "Custom",
          noAlias: hook.noAlias,
        }),
      );
    }

    this.parentFunction = parentFunction;
    this.#contextIdentifiers = contextIdentifiers;
    this.#hoistedIdentifiers = new Set();
  }

  get nextIdentifierId(): IdentifierId {
    return makeIdentifierId(this.#nextIdentifer++);
  }

  get nextBlockId(): BlockId {
    return makeBlockId(this.#nextBlock++);
  }

  get enableDropManualMemoization(): boolean {
    switch (this.outputMode) {
      case "lint": {
        // linting drops to be more compatible with compiler analysis
        return true;
      }
      case "client":
      case "ssr": {
        return true;
      }
      default: {
        return assertExhaustive(this.outputMode, `Unexpected output mode '${this.outputMode}'`);
      }
    }
  }

  get enableValidations(): boolean {
    switch (this.outputMode) {
      case "client":
      case "lint":
      case "ssr": {
        return true;
      }
      default: {
        return assertExhaustive(this.outputMode, `Unexpected output mode '${this.outputMode}'`);
      }
    }
  }

  get nextScopeId(): ScopeId {
    return makeScopeId(this.#nextScope++);
  }

  /**
   * Record a single diagnostic or error detail on this environment.
   * If the error is an Invariant, it is immediately thrown since invariants
   * represent internal bugs that cannot be recovered from.
   * Otherwise, the error is accumulated and optionally logged.
   */
  recordError(error: CompilerDiagnostic | CompilerErrorDetail): void {
    if (error.category === ErrorCategory.Invariant) {
      const compilerError = new CompilerError();
      if (error instanceof CompilerDiagnostic) {
        compilerError.pushDiagnostic(error);
      } else {
        compilerError.pushErrorDetail(error);
      }
      throw compilerError;
    }
    if (error instanceof CompilerDiagnostic) {
      this.#errors.pushDiagnostic(error);
    } else {
      this.#errors.pushErrorDetail(error);
    }
  }

  /**
   * Record all diagnostics from a CompilerError onto this environment.
   */
  recordErrors(error: CompilerError): void {
    for (const detail of error.details) {
      this.recordError(detail);
    }
  }

  /**
   * Returns true if any errors have been recorded during compilation.
   */
  hasErrors(): boolean {
    return this.#errors.hasAnyErrors();
  }

  /**
   * Returns the accumulated CompilerError containing all recorded diagnostics.
   */
  aggregateErrors(): CompilerError {
    return this.#errors;
  }

  isContextIdentifier(node: IdentifierNode): boolean {
    return this.#contextIdentifiers.has(node);
  }

  isHoistedIdentifier(node: IdentifierNode): boolean {
    return this.#hoistedIdentifiers.has(node);
  }

  getGlobalDeclaration(binding: NonLocalBinding): Global | null {
    switch (binding.kind) {
      case "ModuleLocal": {
        // don't resolve module locals
        return isHookName(binding.name) ? this.#getCustomHookType() : null;
      }
      case "Global": {
        return (
          this.#globals.get(binding.name) ??
          (isHookName(binding.name) ? this.#getCustomHookType() : null)
        );
      }
      case "ImportSpecifier": {
        if (this.#isKnownReactModule(binding.module)) {
          /**
           * For `import {imported as name} from "..."` form, we use the `imported`
           * name rather than the local alias. Because we don't have definitions for
           * every React builtin hook yet, we also check to see if the imported name
           * is hook-like (whereas the fall-through below is checking if the aliased
           * name is hook-like)
           */
          return (
            this.#globals.get(binding.imported) ??
            (isHookName(binding.imported) || isHookName(binding.name)
              ? this.#getCustomHookType()
              : null)
          );
        }
        /**
         * For modules we don't own, we look at whether the original name or import alias
         * are hook-like. Both of the following are likely hooks so we would return a hook
         * type for both:
         *
         * `import {useHook as foo} ...`
         * `import {foo as useHook} ...`
         */
        return isHookName(binding.imported) || isHookName(binding.name)
          ? this.#getCustomHookType()
          : null;
      }
      case "ImportDefault":
      case "ImportNamespace": {
        if (this.#isKnownReactModule(binding.module)) {
          // only resolve imports to modules we know about
          return (
            this.#globals.get(binding.name) ??
            (isHookName(binding.name) ? this.#getCustomHookType() : null)
          );
        }
        return isHookName(binding.name) ? this.#getCustomHookType() : null;
      }
    }
  }

  #isKnownReactModule(moduleName: string): boolean {
    return moduleName.toLowerCase() === "react" || moduleName.toLowerCase() === "react-dom";
  }
  static knownReactModules: ReadonlyArray<string> = ["react", "react-dom"];

  getFallthroughPropertyType(receiver: Type, _property: Type): BuiltInType | PolyType | null {
    const shapeId =
      receiver.kind === "Object" || receiver.kind === "Function" ? receiver.shapeId : null;

    if (shapeId !== null) {
      const shape = this.#shapes.get(shapeId);

      CompilerError.invariant(shape !== undefined, {
        reason: `[HIR] Forget internal error: cannot resolve shape ${shapeId}`,
        loc: GeneratedSource,
      });
      return shape.properties.get("*") ?? null;
    }
    return null;
  }

  getPropertyType(receiver: Type, property: string | number): BuiltInType | PolyType | null {
    const shapeId =
      receiver.kind === "Object" || receiver.kind === "Function" ? receiver.shapeId : null;
    if (shapeId !== null) {
      /*
       * If an object or function has a shapeId, it must have been assigned
       * by Forget (and be present in a builtin or user-defined registry)
       */
      const shape = this.#shapes.get(shapeId);
      CompilerError.invariant(shape !== undefined, {
        reason: `[HIR] Forget internal error: cannot resolve shape ${shapeId}`,
        loc: GeneratedSource,
      });
      if (typeof property === "string") {
        return (
          shape.properties.get(property) ??
          shape.properties.get("*") ??
          (isHookName(property) ? this.#getCustomHookType() : null)
        );
      }
      return shape.properties.get("*") ?? null;
    }
    if (typeof property === "string" && isHookName(property)) {
      return this.#getCustomHookType();
    }
    return null;
  }

  getFunctionSignature(type: FunctionType): FunctionSignature | null {
    const shapeId = type.shapeId;
    if (shapeId !== null) {
      const shape = this.#shapes.get(shapeId);
      CompilerError.invariant(shape !== undefined, {
        reason: `[HIR] Forget internal error: cannot resolve shape ${shapeId}`,
        loc: GeneratedSource,
      });
      return shape.functionType;
    }
    return null;
  }

  addHoistedIdentifier(node: IdentifierNode): void {
    this.#contextIdentifiers.add(node);
    this.#hoistedIdentifiers.add(node);
  }

  #getCustomHookType(): Global {
    return this.config.enableAssumeHooksFollowRulesOfReact
      ? DefaultNonmutatingHook
      : DefaultMutatingHook;
  }
}

// From https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/RulesOfHooks.js#LL18C1-L23C2
export const isHookName = (name: string): boolean => /^use[A-Z0-9]/.test(name);

export const validateEnvironmentConfig = (
  partialConfig: PartialEnvironmentConfig,
): EnvironmentConfig => ({
  customHooks: partialConfig.customHooks ?? new Map(),
  enableAssumeHooksFollowRulesOfReact: partialConfig.enableAssumeHooksFollowRulesOfReact ?? true,
  enableTreatRefLikeIdentifiersAsRefs: partialConfig.enableTreatRefLikeIdentifiersAsRefs ?? true,
  enableTreatSetIdentifiersAsStateSetters:
    partialConfig.enableTreatSetIdentifiersAsStateSetters ?? false,
  enablePreserveExistingMemoizationGuarantees:
    partialConfig.enablePreserveExistingMemoizationGuarantees ?? true,
  validatePreserveExistingMemoizationGuarantees:
    partialConfig.validatePreserveExistingMemoizationGuarantees ?? true,
  enableForest: partialConfig.enableForest ?? false,
  validateNoSetStateInRender: partialConfig.validateNoSetStateInRender ?? true,
  validateNoImpureFunctionsInRender: partialConfig.validateNoImpureFunctionsInRender ?? false,
  enableTransitivelyFreezeFunctionExpressions:
    partialConfig.enableTransitivelyFreezeFunctionExpressions ?? true,
});
