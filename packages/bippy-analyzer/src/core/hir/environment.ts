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
  makeBlockId,
  makeIdentifierId,
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
}

export type PartialEnvironmentConfig = Partial<EnvironmentConfig>;

export type ReactFunctionType = "Component" | "Hook" | "Other";

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
  scopes: ScopeManager;
  config: EnvironmentConfig;
  fnType: ReactFunctionType;

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
    config: EnvironmentConfig,
    contextIdentifiers: Set<IdentifierNode>,
    parentFunction: FunctionNode, // the outermost function being compiled
  ) {
    this.scopes = scopes;
    this.fnType = fnType;
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
});
