import type {
  Argument,
  ArrayExpression,
  AssignmentExpression,
  BinaryExpression,
  BindingPattern,
  CallExpression,
  Class,
  Expression,
  JSXAttributeItem,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXFragment,
  JSXMemberExpressionObject,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  ObjectExpression,
  ParamPattern,
  PrivateInExpression,
  PropertyKey,
  Span,
  Statement,
  SwitchStatement,
  TemplateLiteral,
  UnaryExpression,
  UpdateExpression,
} from "oxc-parser";
import type { ModuleGraph } from "../graph/module-graph.js";
import { getLibraryValue } from "../libraries/index.js";
import { getSourceLocation } from "../parse/source-location.js";
import {
  FUNCTION_OWN_KEYS,
  REACT_ELEMENT_OWN_KEYS,
  WRAPPER_OWN_KEYS,
  getReactElementSymbolKey,
} from "../react/element-shape.js";
import { toElementType } from "../react/element-type.js";
import {
  getExternalMember,
  REACT_MEMO_CACHE_SENTINEL_KEY,
  resolveReactApi,
  resolveReactApiMember,
} from "../react/react-api.js";
import { getCompilerHelper, getInlineCompilerHelper } from "./compiler-helpers.js";
import type {
  ClassBody,
  Diagnostic,
  ExternalValueProvider,
  FunctionLikeNode,
  CapturedValue,
  JsonValue,
  ModuleRecord,
  ProjectContext,
  RenderEnvironment,
  ResolvedSymbol,
  Scope,
  SourceLocation,
  StaticClassValue,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticValue,
  TopLevelBinding,
  UnknownPrimitiveType,
} from "../types.js";
import {
  evaluateBuiltinCall,
  getBuiltinGlobal,
  getTypeofValue,
  isModeledOpaqueMethodName,
  isPromiseMethodName,
} from "./builtin-calls.js";
import { collectClassMembers, constructClassInstance } from "./class-component.js";
import { markCollectionExternallyMutable } from "./collections.js";
import { HeapJournal, type MutableHeapValue } from "./heap-journal.js";
import { createStorageAreas, getStorageAreaName, getStorageLength } from "./web-storage.js";
import { type CompiledClass, getCompiledClass } from "./compiled-class.js";
import type { CallFrame, ContextReader, EvaluationContext } from "./context.js";
import { NO_PROVIDERS, withScope } from "./context.js";
import { decodeJsxEntities } from "./jsx-entities.js";
import { cleanJsxText } from "./jsx-text.js";
import { markEscapedSetters } from "./hooks.js";
import { evaluateLoop } from "./loops.js";
import { applyNarrowing, narrowTest, withNarrowedBinding } from "./narrowing.js";
import { evaluateReactApiCall } from "./react-calls.js";
import { createScope, declareInScope, findOwningScope, lookupScope } from "./scope.js";
import {
  areValuesEquivalent,
  branchValue,
  compareIdentity,
  componentReference,
  describeValue,
  FALSE_VALUE,
  falsyCounterpart,
  getKnownObjectKeys,
  getListItem,
  getListLength,
  getObjectProperty,
  getPreferredTruthiness,
  getTruthiness,
  isNullish,
  listValue,
  mapValue,
  NULL_VALUE,
  capturedValue,
  objectValue,
  omitObjectKeys,
  partialJsonValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  spreadListItems,
  unknownValue,
} from "./values.js";

export interface InterpreterOptions {
  maxCallDepth?: number;
  maxForkDepth?: number;
  maxSteps?: number;
  externalValues?: ExternalValueProvider;
  /** `window` properties the served page defines; objects are partial (see `partialJsonValue`). */
  globals?: Record<string, JsonValue>;
  /** `window` properties recorded whole from a running page (see `capturedValue`). */
  capturedGlobals?: Record<string, CapturedValue>;
  /** The rendered tree may be mounted under providers that are not part of the analysis, so unprovided contexts are uncertain. */
  assumeOuterProviders?: boolean;
  /** The analyzed app's React version; decides which `$$typeof` symbol tags elements. */
  reactVersion?: string | null;
  project?: ProjectContext;
}

const UNKNOWN_PROJECT: ProjectContext = {
  hasDeclaredDependency: () => false,
  findQuery: () => null,
  findMutations: () => null,
};

const DEFAULT_MAX_CALL_DEPTH = 32;
const DEFAULT_MAX_FORK_DEPTH = 5;
const DEFAULT_MAX_STEPS = 2_000_000;
export const STYLED_JSX_SPECIFIER = "styled-jsx/style";

const IN_PROGRESS = Symbol("in-progress");

const OBJECT_PROTOTYPE_METHODS = new Set([
  "hasOwnProperty",
  "propertyIsEnumerable",
  "isPrototypeOf",
  "toString",
  "toLocaleString",
  "valueOf",
]);

const PRIMITIVE_PROTOTYPES: Record<UnknownPrimitiveType, object | null> = {
  string: String.prototype,
  number: Number.prototype,
  boolean: Boolean.prototype,
  any: null,
};

/** A member read on a value whose prototype chain is fully known: absent names are `undefined`. */
const prototypeMember = (
  receiver: StaticValue,
  prototype: object | null,
  key: string,
): StaticValue =>
  prototype === null || key in prototype
    ? { kind: "method", receiver, name: key }
    : UNDEFINED_VALUE;

export type LoopJump = "break" | "continue";

/**
 * Result of evaluating a statement list. `returned` collects the values of every
 * path that returned; `mayComplete` is set when at least one path fell through
 * to the end of the list.
 */
export interface StatementOutcome {
  returned: StaticValue | null;
  mayComplete: boolean;
  /** Set when some path left the enclosing loop early; labeled jumps are `uncertain`. */
  jump: LoopJump | "uncertain" | null;
}

export const COMPLETES: StatementOutcome = { returned: null, mayComplete: true, jump: null };

const jumpOutcome = (jump: LoopJump, label: string | null): StatementOutcome => ({
  returned: null,
  mayComplete: false,
  jump: label === null ? jump : "uncertain",
});

const mergeJumps = (outcomes: StatementOutcome[]): StatementOutcome["jump"] => {
  const jumps = outcomes.map((outcome) => outcome.jump).filter((jump) => jump !== null);
  if (jumps.length === 0) return null;
  return jumps.every((jump) => jump === jumps[0]) ? jumps[0] : "uncertain";
};

export interface StatementContinuation {
  (context: EvaluationContext): StatementOutcome;
}

const completeBlock: StatementContinuation = () => COMPLETES;

export const returnOutcome = (value: StaticValue): StatementOutcome => ({
  returned: value,
  mayComplete: false,
  jump: null,
});

export const outcomeToReturnValue = (
  outcome: StatementOutcome,
  location: SourceLocation | null,
): StaticValue => {
  if (!outcome.returned) return UNDEFINED_VALUE;
  if (!outcome.mayComplete) return outcome.returned;
  return branchValue(
    [outcome.returned, UNDEFINED_VALUE],
    "function may fall through without returning",
    location,
  );
};

/**
 * `preferredOutcome` is the index of the outcome the code is expected to take;
 * when that path completes without returning, the fall-through (last) outcome
 * is what it would return.
 */
export const mergeOutcomes = (
  outcomes: StatementOutcome[],
  reason: string,
  location: SourceLocation | null,
  preferredOutcome = 0,
): StatementOutcome => {
  const returnedValues: StaticValue[] = [];
  let preferredIndex = 0;
  const isFallThroughPreferred = !outcomes[preferredOutcome]?.returned;
  outcomes.forEach((outcome, index) => {
    if (!outcome.returned) return;
    if (index === preferredOutcome || (isFallThroughPreferred && index === outcomes.length - 1)) {
      preferredIndex = returnedValues.length;
    }
    returnedValues.push(outcome.returned);
  });
  return {
    returned:
      returnedValues.length > 0
        ? branchValue(returnedValues, reason, location, preferredIndex)
        : null,
    mayComplete: outcomes.some((outcome) => outcome.mayComplete),
    jump: mergeJumps(outcomes),
  };
};

/**
 * A recursive call whose arguments are equivalent to those of an activation
 * already on the stack would never bottom out (dynamic values never become
 * more precise); one that makes progress (walking a tree) is followed until
 * the call-depth limit.
 */
const isNonProgressingRecursion = (
  callStack: CallFrame[],
  fn: StaticFunctionValue,
  args: StaticValue[],
): boolean =>
  callStack.some(
    (frame) =>
      frame.node === fn.node &&
      frame.scope === fn.scope &&
      frame.args.length === args.length &&
      frame.args.every((argument, index) => areValuesEquivalent(argument, args[index])),
  );

const markExternallyMutable = (value: StaticValue, reason: string): void => {
  if (value.kind !== "object" || markCollectionExternallyMutable(value)) return;
  value.entries.push({ kind: "spread", value: unknownValue(reason) });
};

export interface CallOptions {
  thisValue?: StaticValue | null;
  callStack?: CallFrame[];
  /** The caller awaits the result (route `lazy`, server components), so an async body is evaluated with `await x` as `x`. */
  awaited?: boolean;
}

export class Interpreter {
  readonly graph: ModuleGraph;
  readonly diagnostics: Diagnostic[] = [];
  readonly assumeOuterProviders: boolean;
  private readonly maxCallDepth: number;
  private readonly maxForkDepth: number;
  private readonly externalValues: ExternalValueProvider | null;
  private readonly project: ProjectContext;
  private readonly windowGlobals = new Map<string, StaticValue>();
  readonly storageAreas = createStorageAreas();
  private readonly heapJournals: HeapJournal[] = [];
  private readonly heapEpochs = new WeakMap<MutableHeapValue, number>();
  private heapEpoch = 0;
  private readonly elementSymbolKey: string;
  private remainingSteps: number;
  private readonly moduleScopes = new Map<string, Scope>();
  private readonly moduleValues = new Map<string, Map<string, StaticValue | typeof IN_PROGRESS>>();
  private readonly diagnosticKeys = new Set<string>();

  constructor(graph: ModuleGraph, options: InterpreterOptions = {}) {
    this.graph = graph;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxForkDepth = options.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH;
    this.remainingSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.externalValues = options.externalValues ?? null;
    this.project = options.project ?? UNKNOWN_PROJECT;
    for (const [name, json] of Object.entries(options.globals ?? {})) {
      this.windowGlobals.set(name, partialJsonValue(json, `window.${name}`));
    }
    for (const [name, captured] of Object.entries(options.capturedGlobals ?? {})) {
      this.windowGlobals.set(name, capturedValue(captured, `window.${name}`));
    }
    this.elementSymbolKey = getReactElementSymbolKey(options.reactVersion ?? null);
    this.assumeOuterProviders = options.assumeOuterProviders ?? false;
  }

  getWindowGlobal(name: string): StaticValue {
    return this.windowGlobals.get(name) ?? unknownValue(`window.${name}`);
  }

  report(
    code: string,
    message: string,
    location: SourceLocation | null,
    severity: Diagnostic["severity"] = "info",
  ): void {
    const key = `${code}\u0000${message}\u0000${location?.filePath}:${location?.line}:${location?.column}`;
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    this.diagnostics.push({ severity, code, message, location });
  }

  locate(module: ModuleRecord, span: Span): SourceLocation {
    return getSourceLocation(module.file, span);
  }

  createModuleContext(
    module: ModuleRecord,
    readContext: ContextReader = NO_PROVIDERS,
    environment: RenderEnvironment | null = null,
  ): EvaluationContext {
    return {
      module,
      scope: this.getModuleScope(module),
      thisValue: module.isCommonJs ? objectValue() : UNDEFINED_VALUE,
      readContext,
      callStack: [],
      uncertainDepth: 0,
      forkDepth: 0,
      environment,
      hooks: null,
    };
  }

  getModuleScope(module: ModuleRecord): Scope {
    let scope = this.moduleScopes.get(module.filePath);
    if (!scope) {
      scope = createScope(null);
      this.moduleScopes.set(module.filePath, scope);
    }
    return scope;
  }

  evaluateModuleExport(module: ModuleRecord, exportedName: string): StaticValue {
    return this.resolvedSymbolToValue(this.graph.resolveExport(module, exportedName), exportedName);
  }

  /** The exports of a module as an object, for `{ ...m }` / `const { a, ...rest } = m` over a namespace. */
  materializeNamespace(module: ModuleRecord): StaticValue {
    const { names, complete } = this.graph.collectExportNames(module);
    if (!complete) {
      return unknownValue(`namespace of ${module.filePath} re-exports an unanalyzed module`);
    }
    return objectValue(
      names.map((name) => ({
        kind: "property",
        key: name,
        value: this.evaluateModuleExport(module, name),
      })),
    );
  }

  private getModuleValues(module: ModuleRecord): Map<string, StaticValue | typeof IN_PROGRESS> {
    let values = this.moduleValues.get(module.filePath);
    if (!values) {
      values = new Map();
      this.moduleValues.set(module.filePath, values);
    }
    return values;
  }

  evaluateModuleBinding(module: ModuleRecord, name: string): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    const values = this.getModuleValues(module);
    const cached = values.get(name);
    if (cached === IN_PROGRESS) {
      return unknownValue(
        `cyclic module-level evaluation of "${name}"`,
        this.locate(module, binding.span),
      );
    }
    if (cached) return cached;
    values.set(name, IN_PROGRESS);
    const context = this.createModuleContext(module);
    const value = this.evaluateTopLevelBindingValue(module, binding, context);
    values.set(name, value);
    const result = this.applyMemberAssignments(module, name, value, context);
    if (binding.kind === "variable" && module.deferredMutations.has(name)) {
      markExternallyMutable(result, `"${name}" is mutated outside the rendered code`);
    }
    values.set(name, result);
    return result;
  }

  resolvedSymbolToValue(symbol: ResolvedSymbol, nameHint: string | null): StaticValue {
    switch (symbol.kind) {
      case "binding":
        return this.evaluateModuleBinding(symbol.module, symbol.binding.name) ?? UNDEFINED_VALUE;
      case "expression":
        return this.evaluateExpression(
          symbol.expression,
          this.createModuleContext(symbol.module),
          nameHint,
        );
      case "namespace":
        return { kind: "namespace", module: symbol.module };
      case "external": {
        const importedName =
          symbol.imported.kind === "named"
            ? symbol.imported.name
            : symbol.imported.kind === "default"
              ? "default"
              : "*";
        const helper = getCompilerHelper(symbol.packageName, symbol.specifier, importedName);
        if (helper) return helper;
        if (symbol.imported.kind === "named") {
          const api = resolveReactApi(symbol.packageName, symbol.imported.name, symbol.specifier);
          if (api) return { kind: "react-api", api };
        }
        const provided =
          this.externalValues?.(symbol.specifier, importedName) ??
          getLibraryValue(symbol.specifier, importedName, this.project);
        if (provided) return provided;
        if (symbol.imported.kind === "namespace" || symbol.imported.kind === "default") {
          const api = resolveReactApi(symbol.packageName, "*");
          if (api) return { kind: "react-api", api };
        }
        return { kind: "external", packageName: symbol.packageName, importedName, derived: false };
      }
      case "unresolved":
        return unknownValue(symbol.reason);
    }
  }

  private applyMemberAssignments(
    module: ModuleRecord,
    name: string,
    value: StaticValue,
    context: EvaluationContext,
  ): StaticValue {
    let result = value;
    for (const assignment of module.memberAssignments) {
      if (assignment.objectName !== name) continue;
      if (
        assignment.condition &&
        getTruthiness(this.evaluateExpression(assignment.condition, context)) !== true
      )
        continue;
      const assigned = this.evaluateExpression(assignment.value, context, assignment.propertyName);
      result = this.assignProperty(result, assignment.propertyName, assigned, context);
    }
    return result;
  }

  /** What React does with a `ref` on commit: call a callback ref or set `current` on a ref object. */
  assignRef(
    ref: StaticValue,
    node: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
  ): void {
    switch (ref.kind) {
      case "object":
        this.assignProperty(ref, "current", node, context);
        return;
      case "function":
      case "native-function":
      case "method":
      case "proxy":
        this.callValue(ref, [node], context, location);
        return;
      case "branch":
        for (const alternative of ref.alternatives)
          this.assignRef(alternative, node, context, location);
        return;
      case "optional":
        this.assignRef(ref.value, node, context, location);
        return;
      default:
        return;
    }
  }

  private assignProperty(
    target: StaticValue,
    propertyName: string,
    value: StaticValue,
    context: EvaluationContext,
  ): StaticValue {
    switch (target.kind) {
      case "object":
        this.recordHeapMutation(target);
        target.entries.push({ kind: "property", key: propertyName, value });
        return target;
      case "list": {
        const index = Number(propertyName);
        if (Number.isInteger(index) && index >= 0 && index < target.items.length) {
          this.recordHeapMutation(target);
          target.items[index] = value;
        }
        return target;
      }
      case "function":
      case "class":
        target.properties.set(propertyName, value);
        return target;
      case "regexp":
        if (propertyName === "lastIndex") {
          target.lastIndex =
            value.kind === "primitive" && typeof value.value === "number" ? value.value : 0;
        }
        return target;
      case "proxy": {
        const trap = getObjectProperty(target.handler, "set");
        if (trap.kind === "primitive" && trap.value === undefined) {
          this.assignProperty(target.target, propertyName, value, context);
        } else {
          this.callValue(
            trap,
            [target.target, primitiveValue(propertyName), value, target],
            context,
            null,
          );
        }
        return target;
      }
      case "context":
        if (
          propertyName === "displayName" &&
          value.kind === "primitive" &&
          typeof value.value === "string"
        ) {
          target.context.displayName = value.value;
        }
        return target;
      case "component-reference": {
        const type = target.type;
        if (type.kind === "function" || type.kind === "class") {
          type.component.properties.set(propertyName, value);
          return target;
        }
        if (type.kind !== "memo" && type.kind !== "forward-ref" && type.kind !== "lazy")
          return target;
        if (propertyName === "displayName") {
          return value.kind === "primitive" && typeof value.value === "string"
            ? componentReference({ ...type, displayName: value.value })
            : target;
        }
        type.properties.set(propertyName, value);
        return target;
      }
      default:
        return target;
    }
  }

  private evaluateTopLevelBindingValue(
    module: ModuleRecord,
    binding: TopLevelBinding,
    context: EvaluationContext,
  ): StaticValue {
    switch (binding.kind) {
      case "variable":
        return binding.init
          ? this.evaluateExpression(binding.init, context, binding.name)
          : UNDEFINED_VALUE;
      case "function":
        return (
          getInlineCompilerHelper(binding.name) ??
          this.createFunctionValue(binding.node, context, binding.name)
        );
      case "class":
        return this.createClassValue(binding.node, context, binding.name);
      case "import":
        return this.resolvedSymbolToValue(
          this.graph.resolveImport(binding.binding, module),
          binding.name,
        );
      case "destructured": {
        const initValue = binding.init
          ? this.evaluateExpression(binding.init, context, null)
          : UNDEFINED_VALUE;
        const scratch = createScope(null);
        this.bindPattern(binding.pattern, initValue, scratch, context);
        return scratch.bindings.get(binding.name) ?? UNDEFINED_VALUE;
      }
    }
  }

  createFunctionValue(
    node: FunctionLikeNode,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const explicitName = node.type === "ArrowFunctionExpression" ? null : (node.id?.name ?? null);
    return {
      kind: "function",
      node,
      scope: context.scope,
      module: context.module,
      thisValue: node.type === "ArrowFunctionExpression" ? context.thisValue : null,
      name: explicitName ?? nameHint,
      properties: new Map(),
    };
  }

  private createClassValue(
    node: Class,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const superValue = node.superClass
      ? this.evaluateExpression(node.superClass, context, null)
      : null;
    return this.defineClass(
      node,
      { members: collectClassMembers(node), superValue },
      context,
      node.id?.name ?? nameHint,
    );
  }

  /** Materializes a class from its members, evaluating static members with `this` bound to the class. */
  defineClass(
    node: Class | FunctionLikeNode,
    body: ClassBody,
    context: EvaluationContext,
    name: string | null,
  ): StaticClassValue {
    const classValue: StaticClassValue = {
      kind: "class",
      node,
      body,
      scope: context.scope,
      module: context.module,
      name,
      properties: new Map(),
    };
    const staticContext: EvaluationContext = { ...context, thisValue: classValue };
    for (const member of body.members) {
      if (!member.isStatic) continue;
      if (member.kind === "field") {
        classValue.properties.set(
          member.key,
          member.value
            ? this.evaluateExpression(member.value, staticContext, member.key)
            : UNDEFINED_VALUE,
        );
        continue;
      }
      const fn = this.createFunctionValue(member.fn, staticContext, member.key);
      if (fn.kind !== "function") continue;
      const bound: StaticFunctionValue = { ...fn, thisValue: classValue };
      classValue.properties.set(
        member.key,
        member.kind === "getter"
          ? this.callFunction(bound, [], staticContext, { thisValue: classValue })
          : bound,
      );
    }
    return classValue;
  }

  lookupIdentifier(name: string, context: EvaluationContext): StaticValue {
    const scoped = lookupScope(context.scope, name);
    if (scoped) return scoped;
    const moduleValue = this.evaluateModuleBinding(context.module, name);
    if (moduleValue) return moduleValue;
    const builtin = getBuiltinGlobal(name);
    if (builtin) return builtin;
    return unknownValue(`unbound identifier "${name}"`);
  }

  private consumeStep(location: SourceLocation | null): boolean {
    if (this.remainingSteps <= 0) {
      this.report("budget-exhausted", "evaluation step budget exhausted", location, "warning");
      return false;
    }
    this.remainingSteps--;
    return true;
  }

  evaluateExpression(
    node: Expression,
    context: EvaluationContext,
    nameHint: string | null = null,
  ): StaticValue {
    const location = this.locate(context.module, node);
    if (!this.consumeStep(location)) return unknownValue("step budget exhausted", location);
    switch (node.type) {
      case "Literal":
        if ("regex" in node) {
          return {
            kind: "regexp",
            pattern: node.regex.pattern,
            flags: node.regex.flags,
            lastIndex: 0,
          };
        }
        return primitiveValue(node.value);
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node, context);
      case "Identifier":
        if (node.name === "undefined") return UNDEFINED_VALUE;
        return this.lookupIdentifier(node.name, context);
      case "ThisExpression":
        return context.thisValue ?? unknownValue("this outside of a class", location);
      case "ArrayExpression":
        return this.evaluateArrayExpression(node, context);
      case "ObjectExpression":
        return this.evaluateObjectExpression(node, context);
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return this.createFunctionValue(node, context, nameHint);
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
        return unknownValue("function without a body", location);
      case "ClassExpression":
      case "ClassDeclaration":
        return this.createClassValue(node, context, nameHint);
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
      case "ParenthesizedExpression":
        return this.evaluateExpression(node.expression, context, nameHint);
      case "ChainExpression":
        return this.evaluateExpression(node.expression, context, nameHint);
      case "SequenceExpression":
        return this.evaluateExpression(
          node.expressions[node.expressions.length - 1],
          context,
          nameHint,
        );
      case "AwaitExpression": {
        const awaited = this.evaluateExpression(node.argument, context, nameHint);
        if (context.hooks && (awaited.kind === "unknown" || awaited.kind === "external"))
          context.hooks.isDeferred = true;
        return awaited;
      }
      case "MemberExpression":
        return this.evaluateMemberExpression(node, context);
      case "CallExpression":
        return this.evaluateCallExpression(node, context, nameHint);
      case "NewExpression":
        return this.evaluateNewExpression(node, context);
      case "ConditionalExpression": {
        const test = this.evaluateExpression(node.test, context);
        const truthiness = getTruthiness(test);
        if (truthiness === true) return this.evaluateExpression(node.consequent, context, nameHint);
        if (truthiness === false) return this.evaluateExpression(node.alternate, context, nameHint);
        const [consequent, alternate] = this.evaluateTestedPaths(
          node.test,
          context,
          () => this.evaluateExpression(node.consequent, context, nameHint),
          () => this.evaluateExpression(node.alternate, context, nameHint),
        );
        if (!consequent) return alternate ?? UNDEFINED_VALUE;
        if (!alternate) return consequent;
        return branchValue(
          [consequent, alternate],
          `conditional on ${describeValue(test)}`,
          location,
          getPreferredTruthiness(test) === false ? 1 : 0,
        );
      }
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node, context, nameHint);
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node, context);
      case "BinaryExpression":
        return this.evaluateBinaryExpression(node, context);
      case "AssignmentExpression":
        return this.evaluateAssignmentExpression(node, context);
      case "UpdateExpression":
        return this.evaluateUpdateExpression(node, context);
      case "JSXElement":
        return this.evaluateJsxElement(node, context);
      case "JSXFragment":
        return this.evaluateJsxFragment(node, context);
      case "ImportExpression": {
        if (node.source.type !== "Literal" || typeof node.source.value !== "string") {
          return unknownValue("dynamic import with non-literal specifier", location);
        }
        return this.importModule(node.source.value, context, location, false);
      }
      case "TaggedTemplateExpression": {
        const tag = this.evaluateExpression(node.tag, context);
        if (tag.kind === "external") {
          return { ...tag, importedName: `${tag.importedName}\`\``, derived: true };
        }
        const strings = listValue(
          node.quasi.quasis.map((quasi) => primitiveValue(quasi.value.cooked ?? quasi.value.raw)),
        );
        const values = node.quasi.expressions.map((expression) =>
          this.evaluateExpression(expression, context),
        );
        return this.callValue(tag, [strings, ...values], context, location, { nameHint });
      }
      case "MetaProperty":
        return unknownValue(`${node.meta.name}.${node.property.name}`, location);
      case "YieldExpression":
      case "Super":
      case "V8IntrinsicExpression":
        return unknownValue(`unsupported expression ${node.type}`, location);
    }
  }

  private evaluateTemplateLiteral(node: TemplateLiteral, context: EvaluationContext): StaticValue {
    let text = "";
    let isKnown = true;
    node.quasis.forEach((quasi, index) => {
      text += quasi.value.cooked ?? quasi.value.raw;
      if (index < node.expressions.length) {
        const value = this.evaluateExpression(node.expressions[index], context);
        if (value.kind === "primitive") {
          text += String(value.value);
        } else {
          isKnown = false;
        }
      }
    });
    return isKnown
      ? primitiveValue(text)
      : unknownPrimitiveValue("string", "template literal with dynamic parts");
  }

  private evaluateArrayExpression(node: ArrayExpression, context: EvaluationContext): StaticValue {
    const items: StaticValue[] = [];
    for (const element of node.elements) {
      if (element === null) {
        items.push(UNDEFINED_VALUE);
        continue;
      }
      if (element.type === "SpreadElement") {
        const spread = this.evaluateExpression(element.argument, context);
        items.push(...spreadListItems(spread, this.locate(context.module, element)));
        continue;
      }
      items.push(this.evaluateExpression(element, context));
    }
    return this.stampHeapValue(listValue(items));
  }

  private stampHeapValue<Value extends MutableHeapValue>(value: Value): Value {
    this.heapEpochs.set(value, this.heapEpoch);
    return value;
  }

  /** Mutating a value that predates an enclosing fork must be undone for the fork's other paths. */
  recordHeapMutation(target: MutableHeapValue): void {
    const epoch = this.heapEpochs.get(target) ?? 0;
    for (let index = this.heapJournals.length - 1; index >= 0; index--) {
      const journal = this.heapJournals[index];
      if (epoch >= journal.entryEpoch) return;
      journal.record(target);
    }
  }

  private evaluatePropertyKey(
    key: PropertyKey,
    computed: boolean,
    context: EvaluationContext,
  ): string | null {
    if (!computed) {
      if (key.type === "Identifier") return key.name;
      if (key.type === "Literal" && !("regex" in key)) return String(key.value);
      if (key.type === "PrivateIdentifier") return `#${key.name}`;
    }
    if (key.type === "PrivateIdentifier") return `#${key.name}`;
    const value = this.evaluateExpression(key, context);
    if (value.kind === "primitive") return String(value.value);
    return null;
  }

  private evaluateObjectExpression(
    node: ObjectExpression,
    context: EvaluationContext,
  ): StaticValue {
    const entries: StaticObjectEntry[] = [];
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        const spread = this.evaluateExpression(property.argument, context);
        entries.push({
          kind: "spread",
          value: spread.kind === "namespace" ? this.materializeNamespace(spread.module) : spread,
        });
        continue;
      }
      if (property.kind !== "init") continue;
      const key = this.evaluatePropertyKey(property.key, property.computed, context);
      if (key === null) {
        entries.push({ kind: "spread", value: unknownValue("computed property key") });
        continue;
      }
      entries.push({
        kind: "property",
        key,
        value: this.evaluateExpression(property.value, context, key),
      });
    }
    return this.stampHeapValue(objectValue(entries));
  }

  private evaluateLogicalExpression(
    node: LogicalExpression,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const left = this.evaluateExpression(node.left, context, nameHint);
    const location = this.locate(context.module, node);
    switch (node.operator) {
      case "&&": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return this.evaluateExpression(node.right, context, nameHint);
        if (truthiness === false) return left;
        const [right, falsyLeft] = this.evaluateTestedPaths(
          node.left,
          context,
          () => this.evaluateExpression(node.right, context, nameHint),
          (narrowed) =>
            narrowed ? this.evaluateExpression(node.left, context) : falsyCounterpart(left),
        );
        if (!right) return falsyLeft ?? falsyCounterpart(left);
        if (!falsyLeft) return right;
        return branchValue(
          [right, falsyLeft],
          `&& on ${describeValue(left)}`,
          location,
          getPreferredTruthiness(left) === false ? 1 : 0,
        );
      }
      case "||": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return left;
        if (truthiness === false) return this.evaluateExpression(node.right, context, nameHint);
        const [truthyLeft, right] = this.evaluateTestedPaths(
          node.left,
          context,
          (narrowed) => (narrowed ? this.evaluateExpression(node.left, context) : left),
          () => this.evaluateExpression(node.right, context, nameHint),
        );
        if (!truthyLeft) return right ?? left;
        if (!right) return truthyLeft;
        return branchValue(
          [truthyLeft, right],
          `|| on ${describeValue(left)}`,
          location,
          getPreferredTruthiness(left) === false ? 1 : 0,
        );
      }
      case "??": {
        const nullish = isNullish(left);
        if (nullish === false) return left;
        if (nullish === true) return this.evaluateExpression(node.right, context, nameHint);
        return branchValue(
          [left, this.evaluateExpression(node.right, context, nameHint)],
          `?? on ${describeValue(left)}`,
          location,
        );
      }
    }
  }

  /**
   * Evaluates the two sides of an uncertain test with the tested identifier
   * narrowed to what it must be on each side; a side the narrowing rules out
   * is `null`. The callbacks receive the narrowed value when there is one.
   */
  private evaluateTestedPaths<Result>(
    test: Expression,
    context: EvaluationContext,
    onTrue: (narrowed: StaticValue | null) => Result,
    onFalse: (narrowed: StaticValue | null) => Result,
  ): [Result | null, Result | null] {
    const narrowing = narrowTest(test, (name) => lookupScope(context.scope, name));
    if (!narrowing) return [onTrue(null), onFalse(null)];
    const runSide = (value: StaticValue | null, run: (narrowed: StaticValue | null) => Result) =>
      value === null
        ? null
        : withNarrowedBinding(context.scope, narrowing.name, value, () => run(value));
    return [runSide(narrowing.whenTrue, onTrue), runSide(narrowing.whenFalse, onFalse)];
  }

  private evaluateUnaryExpression(node: UnaryExpression, context: EvaluationContext): StaticValue {
    const argument = this.evaluateExpression(node.argument, context);
    switch (node.operator) {
      case "!": {
        const truthiness = getTruthiness(argument);
        if (truthiness === null) {
          return mapValue(argument, (alternative) => {
            const inner = getTruthiness(alternative);
            return inner === null
              ? unknownPrimitiveValue("boolean", "negation of unknown")
              : inner
                ? FALSE_VALUE
                : TRUE_VALUE;
          });
        }
        return truthiness ? FALSE_VALUE : TRUE_VALUE;
      }
      case "typeof":
        return getTypeofValue(argument, context.environment);
      case "-":
        if (argument.kind === "primitive" && typeof argument.value === "number")
          return primitiveValue(-argument.value);
        return unknownPrimitiveValue("number", "unary minus");
      case "+":
        if (argument.kind === "primitive" && typeof argument.value !== "bigint")
          return primitiveValue(Number(argument.value));
        return unknownPrimitiveValue("number", "unary plus");
      case "void":
        return UNDEFINED_VALUE;
      case "~":
        return unknownPrimitiveValue("number", "bitwise not");
      case "delete":
        return TRUE_VALUE;
    }
  }

  private evaluateBinaryExpression(
    node: BinaryExpression | PrivateInExpression,
    context: EvaluationContext,
  ): StaticValue {
    if (node.left.type === "PrivateIdentifier")
      return unknownPrimitiveValue("boolean", "private in");
    const left = this.evaluateExpression(node.left, context);
    const right = this.evaluateExpression(node.right, context);
    if (node.operator === "in")
      return hasProperty(left, right) ?? applyBinaryOperator("in", left, right);
    return applyBinaryOperator(node.operator, left, right);
  }

  private evaluateUpdateExpression(
    node: UpdateExpression,
    context: EvaluationContext,
  ): StaticValue {
    const target = node.argument;
    const current = this.evaluateExpression(target, context);
    const next =
      current.kind === "primitive" && typeof current.value === "number"
        ? primitiveValue(node.operator === "++" ? current.value + 1 : current.value - 1)
        : unknownPrimitiveValue("number", `${node.operator} on ${describeValue(current)}`);
    this.assignTarget(target, next, context);
    return node.prefix ? next : current;
  }

  private evaluateAssignmentExpression(
    node: AssignmentExpression,
    context: EvaluationContext,
  ): StaticValue {
    const target = node.left;
    const nameHint = target.type === "Identifier" ? target.name : null;
    if (node.operator === "=") {
      const value = this.evaluateExpression(node.right, context, nameHint);
      this.assignTarget(target, value, context);
      return value;
    }
    if (target.type === "ObjectPattern" || target.type === "ArrayPattern") {
      this.report(
        "unsupported-assignment",
        "destructuring assignment is not tracked",
        this.locate(context.module, node),
      );
      return unknownValue(`compound assignment ${node.operator}`);
    }
    const current = this.evaluateExpression(target, context);
    let value: StaticValue;
    if (node.operator === "||=" || node.operator === "&&=" || node.operator === "??=") {
      const truthiness =
        node.operator === "??="
          ? isNullish(current) === null
            ? null
            : !isNullish(current)
          : getTruthiness(current);
      const keepsCurrent = node.operator === "&&=" ? truthiness === false : truthiness === true;
      if (keepsCurrent) return current;
      const right = this.evaluateExpression(node.right, context, nameHint);
      value =
        truthiness === null
          ? branchValue([current, right], `${node.operator} on ${describeValue(current)}`)
          : right;
    } else {
      const right = this.evaluateExpression(node.right, context);
      value = applyBinaryOperator(node.operator.slice(0, -1), current, right);
    }
    this.assignTarget(target, value, context);
    return value;
  }

  assignTarget(
    target: AssignmentExpression["left"],
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    if (target.type === "Identifier") {
      this.assignIdentifier(target.name, value, context);
    } else if (
      target.type === "MemberExpression" &&
      !target.computed &&
      target.property.type === "Identifier"
    ) {
      this.assignMember(target.object, target.property.name, value, context);
    } else if (target.type === "MemberExpression" && target.computed) {
      const key = this.evaluateExpression(target.property, context);
      if (key.kind === "primitive") {
        this.assignMember(target.object, String(key.value), value, context);
      }
    } else if (target.type === "ObjectPattern" || target.type === "ArrayPattern") {
      this.report(
        "unsupported-assignment",
        "destructuring assignment is not tracked",
        this.locate(context.module, target),
      );
    }
  }

  private assignMember(
    objectNode: Expression,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ): void {
    const object = this.evaluateExpression(objectNode, context);
    const reassigned = this.assignProperty(object, key, value, context);
    if (reassigned !== object && objectNode.type === "Identifier") {
      this.assignIdentifier(objectNode.name, reassigned, context);
    }
  }

  private assignIdentifier(name: string, value: StaticValue, context: EvaluationContext): void {
    const owner = findOwningScope(context.scope, name);
    if (owner) {
      owner.bindings.set(
        name,
        this.withUncertainAssignment(owner.bindings.get(name), value, name, context),
      );
      return;
    }
    if (context.module.bindings.get(name)?.kind !== "variable") return;
    const values = this.getModuleValues(context.module);
    const previous = values.get(name);
    if (previous === IN_PROGRESS) return;
    values.set(name, this.withUncertainAssignment(previous, value, name, context));
  }

  private withUncertainAssignment(
    previous: StaticValue | undefined,
    value: StaticValue,
    name: string,
    context: EvaluationContext,
  ): StaticValue {
    if (context.uncertainDepth === 0) return value;
    return branchValue(
      [value, previous ?? UNDEFINED_VALUE],
      `assignment to ${name} in an uncertain path`,
    );
  }

  private evaluateMemberExpression(
    node: MemberExpression,
    context: EvaluationContext,
  ): StaticValue {
    const object = this.evaluateExpression(node.object, context);
    const location = this.locate(context.module, node);
    if (node.property.type === "PrivateIdentifier") {
      return this.getProperty(object, `#${node.property.name}`, context, location, node.optional);
    }
    if (!node.computed) {
      return this.getProperty(object, node.property.name, context, location, node.optional);
    }
    const key = this.evaluateExpression(node.property, context);
    if (key.kind === "primitive") {
      return this.getProperty(object, String(key.value), context, location, node.optional);
    }
    if (object.kind === "list") {
      const candidates = object.items.filter((item) => item.kind !== "repeat");
      return candidates.length === 0
        ? unknownValue("index into an unknown list", location)
        : branchValue(candidates, "dynamic list index", location);
    }
    if (object.kind === "object") {
      const values = object.entries
        .filter((entry) => entry.kind === "property")
        .map((entry) => entry.value);
      return values.length === 0
        ? unknownValue("dynamic key into an unknown object", location)
        : branchValue(values, "dynamic object key", location);
    }
    return unknownValue(`dynamic member access on ${describeValue(object)}`, location);
  }

  private readComponentProperty(
    type: StaticElementType,
    key: string,
    location: SourceLocation | null,
  ): StaticValue {
    switch (type.kind) {
      case "function":
      case "class": {
        const property = type.component.properties.get(key);
        if (property) return property;
        if (key === "name") return primitiveValue(type.component.name ?? "");
        if (type.kind === "class" || FUNCTION_OWN_KEYS.has(key)) {
          return key === "displayName"
            ? UNDEFINED_VALUE
            : unknownValue(`${type.component.name ?? "component"}.${key}`, location);
        }
        return UNDEFINED_VALUE;
      }
      case "memo":
      case "forward-ref":
      case "lazy": {
        const property = type.properties.get(key);
        if (property) return property;
        if (key === "displayName")
          return type.displayName === null ? UNDEFINED_VALUE : primitiveValue(type.displayName);
        if (key === "$$typeof") return { kind: "symbol", key: WRAPPER_SYMBOL_KEYS[type.kind] };
        if (WRAPPER_OWN_KEYS[type.kind].has(key))
          return unknownValue(`${type.kind}.${key}`, location);
        return UNDEFINED_VALUE;
      }
      case "stub": {
        const property = type.stub.properties?.get(key);
        if (property) return property;
        if (key === "displayName" || key === "name")
          return type.stub.displayName === null
            ? UNDEFINED_VALUE
            : primitiveValue(type.stub.displayName);
        return unknownValue(`${type.stub.displayName ?? "stub"}.${key}`, location);
      }
      default:
        return key === "displayName" || key === "name"
          ? unknownPrimitiveValue("string", "component name")
          : unknownValue(`component property "${key}"`, location);
    }
  }

  getProperty(
    object: StaticValue,
    key: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    optional = false,
  ): StaticValue {
    switch (object.kind) {
      case "branch":
        return mapValue(object, (alternative) =>
          this.getProperty(alternative, key, context, location, optional),
        );
      case "object": {
        const property = getObjectProperty(object, key);
        if (
          property.kind === "primitive" &&
          property.value === undefined &&
          OBJECT_PROTOTYPE_METHODS.has(key)
        )
          return { kind: "method", receiver: object, name: key };
        return property;
      }
      case "list": {
        if (key === "length") return getListLength(object);
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0) {
          return getListItem(object.items, index, location);
        }
        return object.properties?.get(key) ?? prototypeMember(object, Array.prototype, key);
      }
      case "optional":
        return branchValue(
          [this.getProperty(object.value, key, context, location, optional), UNDEFINED_VALUE],
          object.reason,
          object.location,
        );
      case "regexp":
        if (key === "source") return primitiveValue(object.pattern);
        if (key === "flags") return primitiveValue(object.flags);
        if (key === "global") return primitiveValue(object.flags.includes("g"));
        if (key === "lastIndex") return primitiveValue(object.lastIndex);
        return prototypeMember(object, RegExp.prototype, key);
      case "symbol":
        if (key === "description") return primitiveValue(object.key);
        return prototypeMember(object, Symbol.prototype, key);
      case "primitive":
        if (object.value === null || object.value === undefined) {
          if (optional) return UNDEFINED_VALUE;
          return unknownValue(`property "${key}" of ${String(object.value)}`, location);
        }
        if (typeof object.value === "string" && key === "length")
          return primitiveValue(object.value.length);
        return prototypeMember(object, Object.getPrototypeOf(object.value), key);
      case "unknown-primitive":
        if (key === "length") return unknownPrimitiveValue("number", "length of dynamic value");
        return prototypeMember(object, PRIMITIVE_PROTOTYPES[object.primitiveType], key);
      case "context":
        if (key === "Provider") {
          return componentReference({
            kind: "context-provider",
            context: object.context,
            displayName: object.context.displayName,
          });
        }
        if (key === "Consumer") {
          return componentReference({
            kind: "context-consumer",
            context: object.context,
            displayName: object.context.displayName,
          });
        }
        if (key === "displayName") {
          return object.context.displayName === null
            ? UNDEFINED_VALUE
            : primitiveValue(object.context.displayName);
        }
        return unknownValue(`context property "${key}"`, location);
      case "react-api": {
        if (key === "call" || key === "apply" || key === "bind")
          return { kind: "method", receiver: object, name: key };
        const member = resolveReactApiMember(object.api, key);
        if (member) return member;
        return unknownValue(`React.${object.api}.${key}`, location);
      }
      case "external":
        if (object.importedName === "*" && !object.derived) {
          if (key === "__esModule") return TRUE_VALUE;
          if (key === "default") {
            return this.resolvedSymbolToValue(
              {
                kind: "external",
                packageName: object.packageName,
                imported: { kind: "default" },
                specifier: object.packageName,
              },
              null,
            );
          }
        }
        if (object.derived && isModeledOpaqueMethodName(key))
          return { kind: "method", receiver: object, name: key };
        return getExternalMember(object, key);
      case "namespace":
        if (isPromiseMethodName(key)) return { kind: "method", receiver: object, name: key };
        if (key === "__esModule" && !object.module.isCommonJs) return TRUE_VALUE;
        return this.evaluateModuleExport(object.module, key);
      case "global": {
        const storageAreaName = getStorageAreaName(object.name);
        if (storageAreaName !== null) {
          return key === "length"
            ? getStorageLength(this.storageAreas[storageAreaName], storageAreaName)
            : { kind: "method", receiver: object, name: key };
        }
        return (
          (object.name === "window" ? this.windowGlobals.get(key) : undefined) ??
          getBuiltinGlobal(`${object.name}.${key}`) ?? {
            kind: "method",
            receiver: object,
            name: key,
          }
        );
      }
      case "element":
        if (key === "props") return object.props;
        if (key === "key") return object.key ?? NULL_VALUE;
        if (key === "type") return componentReference(object.type);
        if (key === "$$typeof") return { kind: "symbol", key: this.elementSymbolKey };
        if (!REACT_ELEMENT_OWN_KEYS.has(key)) return UNDEFINED_VALUE;
        return unknownValue(`element.${key}`, location);
      case "function":
      case "class": {
        const property = object.properties.get(key);
        if (property) return property;
        if (key === "displayName") return UNDEFINED_VALUE;
        if (key === "name") return object.name ? primitiveValue(object.name) : primitiveValue("");
        return unknownValue(`${describeValue(object)}.${key}`, location);
      }
      case "component-reference":
        return this.readComponentProperty(object.type, key, location);
      case "repeat":
        if (key === "length") return unknownPrimitiveValue("number", "length of a repeated list");
        return { kind: "method", receiver: object, name: key };
      case "method":
        return unknownValue(`property "${key}" of a method`, location);
      case "native-function":
        if (key === "call" || key === "apply" || key === "bind")
          return { kind: "method", receiver: object, name: key };
        return unknownValue(`property "${key}" of ${object.name}`, location);
      case "proxy": {
        const trap = getObjectProperty(object.handler, "get");
        return trap.kind === "primitive" && trap.value === undefined
          ? this.getProperty(object.target, key, context, location, optional)
          : this.callValue(trap, [object.target, primitiveValue(key), object], context, location);
      }
      case "host-node":
        if (key === "tagName" || key === "nodeName")
          return primitiveValue(object.tagName.toUpperCase());
        if (key === "localName") return primitiveValue(object.tagName);
        if (key === "nodeType") return primitiveValue(1);
        return unknownValue(`property "${key}" of <${object.tagName}> node`, location);
      case "unknown":
        return unknownValue(object.reason, location);
    }
  }

  evaluateArguments(args: Argument[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const argument of args) {
      if (argument.type === "SpreadElement") {
        const spread = this.evaluateExpression(argument.argument, context);
        if (spread.kind === "list" && spread.items.every((item) => item.kind !== "repeat")) {
          values.push(...spread.items);
        } else {
          values.push(unknownValue(`spread argument ${describeValue(spread)}`));
        }
        continue;
      }
      values.push(this.evaluateExpression(argument, context));
    }
    return values;
  }

  /**
   * `import("x")` / `require("x")`. A `require` of a CommonJS module yields its
   * `module.exports` value; everything else yields the module namespace.
   */
  private importModule(
    specifier: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    isRequire: boolean,
  ): StaticValue {
    const target = this.graph.resolveImportedModule(specifier, context.module);
    if ("bindings" in target) {
      if (
        isRequire &&
        target.isCommonJs &&
        target.exports.some((entry) => "exportedName" in entry && entry.exportedName === "default")
      ) {
        return this.evaluateModuleExport(target, "default");
      }
      return { kind: "namespace", module: target };
    }
    if (target.kind === "external" || target.kind === "builtin") {
      const packageName = target.kind === "external" ? target.packageName : target.specifier;
      return this.resolvedSymbolToValue(
        { kind: "external", packageName, imported: { kind: "namespace" }, specifier },
        null,
      );
    }
    return unknownValue(
      target.kind === "unresolved"
        ? `cannot resolve "${specifier}": ${target.error}`
        : `module "${specifier}" was not loaded into the graph`,
      location,
    );
  }

  private getRequireSpecifier(node: CallExpression, context: EvaluationContext): string | null {
    if (node.callee.type !== "Identifier" || node.callee.name !== "require") return null;
    if (node.arguments.length !== 1 || node.arguments[0].type !== "Literal") return null;
    if (typeof node.arguments[0].value !== "string") return null;
    if (lookupScope(context.scope, "require") || context.module.bindings.has("require"))
      return null;
    return node.arguments[0].value;
  }

  private evaluateCallExpression(
    node: CallExpression,
    context: EvaluationContext,
    nameHint: string | null,
  ): StaticValue {
    const location = this.locate(context.module, node);
    const compiled = getCompiledClass(node);
    if (compiled) return this.evaluateCompiledClass(compiled, node, context);
    const requiredSpecifier = this.getRequireSpecifier(node, context);
    if (requiredSpecifier !== null)
      return this.importModule(requiredSpecifier, context, location, true);
    let callee: StaticValue;
    let thisValue: StaticValue | null = null;
    if (node.callee.type === "MemberExpression") {
      const receiver = this.evaluateExpression(node.callee.object, context);
      thisValue = receiver;
      if (node.callee.property.type === "PrivateIdentifier") {
        callee = this.getProperty(
          receiver,
          `#${node.callee.property.name}`,
          context,
          location,
          node.callee.optional,
        );
      } else if (!node.callee.computed) {
        callee = this.getProperty(
          receiver,
          node.callee.property.name,
          context,
          location,
          node.callee.optional,
        );
      } else {
        const key = this.evaluateExpression(node.callee.property, context);
        callee =
          key.kind === "primitive"
            ? this.getProperty(receiver, String(key.value), context, location, node.callee.optional)
            : unknownValue("computed method call", location);
      }
    } else {
      callee = this.evaluateExpression(node.callee, context);
    }
    if (
      node.optional &&
      callee.kind === "primitive" &&
      (callee.value === null || callee.value === undefined)
    ) {
      return UNDEFINED_VALUE;
    }
    const args = this.evaluateArguments(node.arguments, context);
    return this.callValue(callee, args, context, location, { thisValue, nameHint });
  }

  callValue(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
    options: { thisValue?: StaticValue | null; nameHint?: string | null } = {},
  ): StaticValue {
    switch (callee.kind) {
      case "branch":
        return mapValue(callee, (alternative) =>
          this.callValue(alternative, args, context, location, options),
        );
      case "function":
        return this.callFunction(callee, args, context, {
          thisValue: options.thisValue ?? callee.thisValue,
        });
      case "react-api":
        return evaluateReactApiCall(
          this,
          callee.api,
          args,
          context,
          location,
          options.nameHint ?? null,
        );
      case "method":
      case "global": {
        const result = evaluateBuiltinCall(this, callee, args, context, location);
        if (result.kind === "unknown") this.markEscapes(args);
        return result;
      }
      case "external":
        this.markEscapes(args);
        return {
          kind: "external",
          packageName: callee.packageName,
          importedName: `${callee.importedName}()`,
          derived: true,
        };
      case "native-function":
        return callee.call(args, {
          readContext: (definition) => context.readContext(definition) ?? definition.defaultValue,
          callAwaited: (fn, fnArgs) => this.callAwaited(fn, fnArgs, context, location),
          call: (fn, fnArgs) => this.callValue(fn, fnArgs, context, location),
          nameHint: options.nameHint ?? null,
        });
      case "class":
        return unknownValue(`class ${callee.name ?? ""} called without new`, location);
      case "proxy": {
        const trap = getObjectProperty(callee.handler, "apply");
        return trap.kind === "primitive" && trap.value === undefined
          ? this.callValue(callee.target, args, context, location, options)
          : this.callValue(
              trap,
              [callee.target, options.thisValue ?? UNDEFINED_VALUE, listValue(args)],
              context,
              location,
            );
      }
      case "unknown":
        this.markEscapes(args);
        return unknownValue(`call of ${callee.reason}`, location);
      case "primitive":
        return unknownValue(`call of ${String(callee.value)}`, location);
      default:
        this.markEscapes(args);
        return unknownValue(`call of ${describeValue(callee)}`, location);
    }
  }

  private markEscapes(args: StaticValue[]): void {
    for (const argument of args) markEscapedSetters(argument);
  }

  private evaluateNewExpression(node: NewExpression, context: EvaluationContext): StaticValue {
    const callee = this.evaluateExpression(node.callee, context);
    const location = this.locate(context.module, node);
    const args = this.evaluateArguments(node.arguments, context);
    return this.construct(callee, args, context, location);
  }

  construct(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    if (callee.kind === "global") {
      return evaluateBuiltinCall(this, callee, args, context, location, true);
    }
    if (callee.kind === "native-function") return this.callValue(callee, args, context, location);
    if (callee.kind === "class") return constructClassInstance(this, callee, args, context);
    if (callee.kind === "proxy") {
      const trap = getObjectProperty(callee.handler, "construct");
      return trap.kind === "primitive" && trap.value === undefined
        ? this.construct(callee.target, args, context, location)
        : this.callValue(trap, [callee.target, listValue(args), callee], context, location);
    }
    this.markEscapes(args);
    return unknownValue(`new ${describeValue(callee)}`, location);
  }

  /** Calls a promise continuation: updates it queues land after the captured commit. */
  callDeferred(
    fn: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
  ): StaticValue {
    const frame = context.hooks;
    if (!frame) return this.callFunction(fn, args, context);
    const wasDeferred = frame.isDeferred;
    frame.isDeferred = true;
    try {
      return this.callFunction(fn, args, context);
    } finally {
      frame.isDeferred = wasDeferred;
    }
  }

  /** Calls `callee` as a framework does when it awaits the returned promise. */
  callAwaited(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ): StaticValue {
    if (callee.kind === "function") {
      return this.callFunction(callee, args, context, { awaited: true });
    }
    return this.callValue(callee, args, context, location);
  }

  callFunction(
    fn: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions = {},
  ): StaticValue {
    const callStack = options.callStack ?? context.callStack;
    const location = this.locate(fn.module, fn.node);
    if (callStack.length >= this.maxCallDepth) {
      this.report(
        "max-call-depth",
        `call depth ${this.maxCallDepth} exceeded`,
        location,
        "warning",
      );
      return unknownValue("call depth exceeded", location);
    }
    if (isNonProgressingRecursion(callStack, fn, args)) {
      return unknownValue(`recursive call of ${fn.name ?? "anonymous function"}`, location);
    }
    if (fn.node.generator) return unknownValue("generator function result", location);
    const frame = context.hooks;
    const wasDeferred = frame?.isDeferred ?? false;
    const result = this.evaluateFunctionBody(fn, args, context, options);
    // An async body runs synchronously up to its first `await` of an unknown
    // promise; only a framework-awaited call (server components, route `lazy`)
    // lets what follows count as settled before the captured commit.
    if (frame && fn.node.async && !options.awaited && frame.isDeferred && !wasDeferred) {
      frame.isDeferred = wasDeferred;
      return unknownValue("promise settled asynchronously", location);
    }
    return result;
  }

  private evaluateFunctionBody(
    fn: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions,
  ): StaticValue {
    const location = this.locate(fn.module, fn.node);
    const callStack = options.callStack ?? context.callStack;
    const scope = createScope(fn.scope);
    const callContext: EvaluationContext = {
      module: fn.module,
      scope,
      thisValue:
        fn.node.type === "ArrowFunctionExpression" ? fn.thisValue : (options.thisValue ?? null),
      readContext: context.readContext,
      callStack: [...callStack, { node: fn.node, scope: fn.scope, args }],
      uncertainDepth: context.uncertainDepth,
      forkDepth: context.forkDepth,
      environment: context.environment,
      hooks: context.hooks,
    };
    this.bindParameters(fn.node.params, args, scope, callContext);
    if (fn.node.type !== "ArrowFunctionExpression") {
      declareInScope(scope, "arguments", listValue(args));
    }
    const body = fn.node.body;
    if (!body) return UNDEFINED_VALUE;
    if (body.type !== "BlockStatement") {
      return this.evaluateExpression(body, callContext);
    }
    const outcome = this.evaluateBlock(body.body, callContext, false);
    return outcomeToReturnValue(outcome, location);
  }

  /**
   * The wrapper runs once: its parameter is the base class, the constructor is
   * declared as the class itself so helpers such as `_inheritsLoose(X, Base)`
   * see it, and the remaining setup runs for whatever the members close over.
   */
  private evaluateCompiledClass(
    compiled: CompiledClass,
    call: CallExpression,
    context: EvaluationContext,
  ): StaticValue {
    const superValue = this.evaluateArguments(call.arguments, context)[0] ?? UNDEFINED_VALUE;
    const scope = createScope(context.scope);
    const wrapperContext: EvaluationContext = { ...context, scope };
    this.bindParameters(compiled.wrapper.params, [superValue], scope, wrapperContext);
    const classValue = this.defineClass(
      compiled.wrapper,
      { members: compiled.members, superValue },
      wrapperContext,
      compiled.name,
    );
    declareInScope(scope, compiled.name, classValue);
    this.evaluateBlock(compiled.setup, wrapperContext, false);
    return classValue;
  }

  private bindParameters(
    params: ParamPattern[],
    args: StaticValue[],
    scope: Scope,
    context: EvaluationContext,
  ): void {
    params.forEach((param, index) => {
      if (param.type === "RestElement") {
        this.bindPattern(param.argument, listValue(args.slice(index)), scope, context);
        return;
      }
      const pattern = param.type === "TSParameterProperty" ? param.parameter : param;
      this.bindPattern(pattern, args[index] ?? UNDEFINED_VALUE, scope, context);
    });
  }

  bindPattern(
    pattern: BindingPattern,
    value: StaticValue,
    scope: Scope,
    context: EvaluationContext,
  ): void {
    switch (pattern.type) {
      case "Identifier":
        declareInScope(scope, pattern.name, value);
        return;
      case "AssignmentPattern": {
        const nullish = isNullish(value);
        const patternName = pattern.left.type === "Identifier" ? pattern.left.name : null;
        if (nullish === true || (value.kind === "primitive" && value.value === undefined)) {
          this.bindPattern(
            pattern.left,
            this.evaluateExpression(pattern.right, withScope(context, scope), patternName),
            scope,
            context,
          );
          return;
        }
        if (nullish === false) {
          this.bindPattern(pattern.left, value, scope, context);
          return;
        }
        const fallback = this.evaluateExpression(
          pattern.right,
          withScope(context, scope),
          patternName,
        );
        this.bindPattern(
          pattern.left,
          branchValue([fallback, value], `default for ${patternName ?? "pattern"}`),
          scope,
          context,
        );
        return;
      }
      case "ObjectPattern": {
        const usedKeys = new Set<string>();
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            const source =
              value.kind === "namespace" ? this.materializeNamespace(value.module) : value;
            const rest =
              source.kind === "object"
                ? omitObjectKeys(source, usedKeys)
                : unknownValue(`rest of ${describeValue(source)}`);
            this.bindPattern(property.argument, rest, scope, context);
            continue;
          }
          const key = this.evaluatePropertyKey(
            property.key,
            property.computed,
            withScope(context, scope),
          );
          if (key === null) {
            this.bindPattern(
              property.value,
              unknownValue("computed destructuring key"),
              scope,
              context,
            );
            continue;
          }
          usedKeys.add(key);
          this.bindPattern(
            property.value,
            this.getProperty(value, key, context, null, true),
            scope,
            context,
          );
        }
        return;
      }
      case "ArrayPattern": {
        pattern.elements.forEach((element, index) => {
          if (!element) return;
          if (element.type === "RestElement") {
            const rest =
              value.kind === "list" &&
              value.items.slice(0, index).every((item) => item.kind !== "repeat")
                ? listValue(value.items.slice(index))
                : unknownValue(`rest of ${describeValue(value)}`);
            this.bindPattern(element.argument, rest, scope, context);
            return;
          }
          this.bindPattern(
            element,
            this.getProperty(value, String(index), context, null, true),
            scope,
            context,
          );
        });
        return;
      }
    }
  }

  private hoistDeclarations(statements: Statement[], context: EvaluationContext): void {
    for (const statement of statements) {
      if (statement.type === "FunctionDeclaration" && statement.id) {
        declareInScope(
          context.scope,
          statement.id.name,
          this.createFunctionValue(statement, context, statement.id.name),
        );
      }
    }
  }

  /**
   * Statement lists are evaluated in continuation-passing style: `continuation`
   * is the rest of the enclosing function, so a fork inside a nested block runs
   * everything after it once per path instead of leaking one path's scope state
   * into the parent list.
   */
  evaluateBlock(
    statements: Statement[],
    context: EvaluationContext,
    createChildScope: boolean,
    continuation: StatementContinuation = completeBlock,
  ): StatementOutcome {
    const blockContext = createChildScope
      ? withScope(context, createScope(context.scope))
      : context;
    this.hoistDeclarations(statements, blockContext);
    return this.evaluateStatements(statements, 0, blockContext, continuation);
  }

  private evaluateStatements(
    statements: Statement[],
    startIndex: number,
    context: EvaluationContext,
    continuation: StatementContinuation,
  ): StatementOutcome {
    for (let index = startIndex; index < statements.length; index++) {
      const statement = statements[index];
      const location = this.locate(context.module, statement);
      if (!this.consumeStep(location))
        return returnOutcome(unknownValue("step budget exhausted", location));
      const proceed: StatementContinuation = (pathContext) =>
        this.evaluateStatements(
          statements,
          index + 1,
          withScope(pathContext, context.scope),
          continuation,
        );
      switch (statement.type) {
        case "ReturnStatement":
          return returnOutcome(
            statement.argument
              ? this.evaluateExpression(statement.argument, context)
              : UNDEFINED_VALUE,
          );
        case "ThrowStatement":
          return returnOutcome({ ...unknownValue("component throws", location), isThrown: true });
        case "BreakStatement":
          return jumpOutcome("break", statement.label?.name ?? null);
        case "ContinueStatement":
          return jumpOutcome("continue", statement.label?.name ?? null);
        case "VariableDeclaration":
          for (const declarator of statement.declarations) {
            const nameHint = declarator.id.type === "Identifier" ? declarator.id.name : null;
            const value = declarator.init
              ? this.evaluateExpression(declarator.init, context, nameHint)
              : UNDEFINED_VALUE;
            this.bindPattern(declarator.id, value, context.scope, context);
          }
          break;
        case "FunctionDeclaration":
          break;
        case "ClassDeclaration":
          if (statement.id) {
            declareInScope(
              context.scope,
              statement.id.name,
              this.createClassValue(statement, context, statement.id.name),
            );
          }
          break;
        case "ExpressionStatement":
          this.evaluateExpression(statement.expression, context);
          break;
        case "BlockStatement":
          return this.evaluateBlock(statement.body, context, true, proceed);
        case "IfStatement": {
          const test = this.evaluateExpression(statement.test, context);
          const truthiness = getTruthiness(test);
          const alternate = statement.alternate;
          const runConsequent: StatementContinuation = (pathContext) =>
            this.evaluateBlock([statement.consequent], pathContext, true, proceed);
          const runAlternate: StatementContinuation = (pathContext) =>
            alternate
              ? this.evaluateBlock([alternate], pathContext, true, proceed)
              : proceed(pathContext);
          if (truthiness === true) return runConsequent(context);
          if (truthiness === false) return runAlternate(context);
          const narrowing = narrowTest(statement.test, (name) => lookupScope(context.scope, name));
          if (narrowing?.whenTrue === null) return runAlternate(context);
          if (narrowing?.whenFalse === null) return runConsequent(context);
          const narrowed =
            (value: StaticValue | null, run: StatementContinuation): StatementContinuation =>
            (pathContext) => {
              if (narrowing && value) applyNarrowing(context.scope, narrowing.name, value);
              return run(pathContext);
            };
          return this.forkPaths(
            [
              narrowed(narrowing?.whenTrue ?? null, (pathContext) =>
                this.evaluateBlock([statement.consequent], pathContext, true),
              ),
              narrowed(narrowing?.whenFalse ?? null, (pathContext) =>
                alternate ? this.evaluateBlock([alternate], pathContext, true) : COMPLETES,
              ),
            ],
            context,
            proceed,
            `if (${describeValue(test)})`,
            location,
            getPreferredTruthiness(test) === false ? 1 : 0,
          );
        }
        case "SwitchStatement":
          return this.evaluateSwitch(statement, context, proceed, location);
        case "TryStatement": {
          const finalizer = statement.finalizer;
          return this.evaluateBlock(
            statement.block.body,
            context,
            true,
            finalizer
              ? (pathContext) => this.evaluateBlock(finalizer.body, pathContext, true, proceed)
              : proceed,
          );
        }
        case "ForOfStatement":
        case "ForInStatement":
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement": {
          const outcome = evaluateLoop(this, statement, context, location);
          if (!outcome.mayComplete) return outcome;
          if (!outcome.returned) break;
          // Loop bodies are not in continuation style: a return on some
          // iterations leaves the rest of the function uncertain.
          const rest = proceed({ ...context, uncertainDepth: context.uncertainDepth + 1 });
          return mergeOutcomes(
            [{ returned: outcome.returned, mayComplete: false, jump: null }, rest],
            "return inside a loop",
            location,
          );
        }
        case "LabeledStatement":
          return this.evaluateBlock([statement.body], context, false, proceed);
        default:
          break;
      }
    }
    return continuation(context);
  }

  /**
   * Runs each path from the same scope state, then joins the states of the
   * paths that complete normally (bindings that differ become branch values,
   * like SSA phis) and continues with the rest of the function exactly once.
   * Paths that jump out of a loop are joined too: the loop then gives up
   * unrolling, so their state is only ever observed as uncertain.
   */
  private forkPaths(
    branches: StatementContinuation[],
    context: EvaluationContext,
    proceed: StatementContinuation,
    reason: string,
    location: SourceLocation,
    preferredBranch = 0,
  ): StatementOutcome {
    const isTooDeep = context.forkDepth >= this.maxForkDepth;
    const forkContext: EvaluationContext = {
      ...context,
      forkDepth: context.forkDepth + 1,
      uncertainDepth: context.uncertainDepth + (isTooDeep ? 1 : 0),
    };
    const entrySnapshot = snapshotScopes(context.scope);
    const hookCursor = context.hooks?.cursor ?? 0;
    const joinedSnapshots: ScopeSnapshot[][] = [];
    let completedHookCursor = hookCursor;
    const journal = new HeapJournal(++this.heapEpoch);
    this.heapJournals.push(journal);
    const outcomes = branches.map((branch, branchIndex) => {
      if (branchIndex > 0) {
        restoreScopes(entrySnapshot);
        if (context.hooks) context.hooks.cursor = hookCursor;
      }
      const outcome = branch(forkContext);
      if (outcome.mayComplete || outcome.jump !== null) {
        joinedSnapshots.push(snapshotScopes(context.scope));
      }
      if (outcome.mayComplete) completedHookCursor = context.hooks?.cursor ?? hookCursor;
      journal.endPath();
      return outcome;
    });
    this.heapJournals.pop();
    journal.join(reason, location, preferredBranch);
    if (joinedSnapshots.length > 0) joinScopes(joinedSnapshots, reason, location);
    if (!outcomes.some((outcome) => outcome.mayComplete)) {
      return mergeOutcomes(outcomes, reason, location, preferredBranch);
    }
    if (context.hooks) context.hooks.cursor = completedHookCursor;
    const rest = proceed(context);
    return mergeOutcomes(
      [...outcomes.map((outcome) => ({ ...outcome, mayComplete: false })), rest],
      reason,
      location,
      preferredBranch,
    );
  }

  private evaluateSwitch(
    statement: SwitchStatement,
    context: EvaluationContext,
    proceed: StatementContinuation,
    location: SourceLocation,
  ): StatementOutcome {
    const discriminant = this.evaluateExpression(statement.discriminant, context);
    const caseValues = statement.cases.map((switchCase) =>
      switchCase.test ? this.evaluateExpression(switchCase.test, context) : null,
    );
    const runCases = (caseIndex: number, switchContext: EvaluationContext): StatementOutcome => {
      if (caseIndex >= statement.cases.length) return COMPLETES;
      return this.evaluateBlock(
        statement.cases[caseIndex].consequent,
        switchContext,
        false,
        (pathContext) => runCases(caseIndex + 1, pathContext),
      );
    };
    const runFrom = (startCase: number, pathContext: EvaluationContext): StatementOutcome => {
      const outcome = runCases(startCase, withScope(pathContext, createScope(pathContext.scope)));
      return outcome.jump === "break" ? { ...outcome, mayComplete: true, jump: null } : outcome;
    };
    const runThenProceed = (startCase: number): StatementOutcome => {
      const outcome = runFrom(startCase, context);
      if (!outcome.mayComplete) return outcome;
      const rest = proceed(context);
      return mergeOutcomes(
        [{ ...outcome, mayComplete: false }, rest],
        `switch (${describeValue(discriminant)})`,
        location,
      );
    };
    if (
      discriminant.kind === "primitive" &&
      caseValues.every((value) => value === null || value.kind === "primitive")
    ) {
      let matchIndex = caseValues.findIndex(
        (value) =>
          value !== null &&
          value.kind === "primitive" &&
          Object.is(value.value, discriminant.value),
      );
      if (matchIndex === -1)
        matchIndex = statement.cases.findIndex((switchCase) => switchCase.test === null);
      return matchIndex === -1 ? proceed(context) : runThenProceed(matchIndex);
    }
    const hasDefault = statement.cases.some((switchCase) => switchCase.test === null);
    const branches: StatementContinuation[] = statement.cases.map(
      (_, caseIndex) => (pathContext) => runFrom(caseIndex, pathContext),
    );
    if (!hasDefault) branches.push(() => COMPLETES);
    return this.forkPaths(
      branches,
      context,
      proceed,
      `switch (${describeValue(discriminant)})`,
      location,
    );
  }

  private evaluateJsxName(
    name: JSXElementName | JSXMemberExpressionObject,
    context: EvaluationContext,
    isMemberObject = false,
  ): StaticValue {
    switch (name.type) {
      case "JSXIdentifier":
        // Only a bare lowercase tag is a host element; `<ctx.Provider>` looks
        // up `ctx` whatever its case.
        if (!isMemberObject && /^[a-z]/.test(name.name)) return primitiveValue(name.name);
        return this.lookupIdentifier(name.name, context);
      case "JSXNamespacedName":
        return primitiveValue(`${name.namespace.name}:${name.name.name}`);
      case "JSXMemberExpression": {
        const object = this.evaluateJsxName(name.object, context, true);
        return this.getProperty(
          object,
          name.property.name,
          context,
          this.locate(context.module, name),
        );
      }
    }
  }

  private describeJsxName(name: JSXElementName | JSXMemberExpressionObject): string {
    switch (name.type) {
      case "JSXIdentifier":
        return name.name;
      case "JSXNamespacedName":
        return `${name.namespace.name}:${name.name.name}`;
      case "JSXMemberExpression":
        return `${this.describeJsxName(name.object)}.${name.property.name}`;
    }
  }

  private evaluateJsxAttributes(
    attributes: JSXAttributeItem[],
    context: EvaluationContext,
  ): { props: StaticObjectValue; key: StaticValue | null } {
    const entries: StaticObjectEntry[] = [];
    let key: StaticValue | null = null;
    for (const attribute of attributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        entries.push({
          kind: "spread",
          value: this.evaluateExpression(attribute.argument, context),
        });
        continue;
      }
      const name =
        attribute.name.type === "JSXIdentifier"
          ? attribute.name.name
          : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
      let value: StaticValue;
      if (attribute.value === null) {
        value = TRUE_VALUE;
      } else if (attribute.value.type === "Literal") {
        value = primitiveValue(
          typeof attribute.value.value === "string"
            ? decodeJsxEntities(attribute.value.value)
            : attribute.value.value,
        );
      } else if (attribute.value.type === "JSXExpressionContainer") {
        value =
          attribute.value.expression.type === "JSXEmptyExpression"
            ? UNDEFINED_VALUE
            : this.evaluateExpression(attribute.value.expression, context, name);
      } else {
        value = this.evaluateExpression(attribute.value, context, name);
      }
      if (name === "key") {
        key = value;
        continue;
      }
      entries.push({ kind: "property", key: name, value });
    }
    return { props: objectValue(entries), key };
  }

  evaluateJsxChildren(children: JSXChild[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const child of children) {
      switch (child.type) {
        case "JSXText": {
          const text = decodeJsxEntities(cleanJsxText(child.value));
          if (text) values.push(primitiveValue(text));
          break;
        }
        case "JSXExpressionContainer":
          if (child.expression.type !== "JSXEmptyExpression") {
            values.push(this.evaluateExpression(child.expression, context));
          }
          break;
        case "JSXSpreadChild": {
          const spread = this.evaluateExpression(child.expression, context);
          if (spread.kind === "list") values.push(...spread.items);
          else values.push(unknownValue("spread child"));
          break;
        }
        case "JSXElement":
          values.push(this.evaluateJsxElement(child, context));
          break;
        case "JSXFragment":
          values.push(this.evaluateJsxFragment(child, context));
          break;
      }
    }
    return values;
  }

  createElement(
    type: StaticValue,
    props: StaticObjectValue,
    key: StaticValue | null,
    children: StaticValue[],
    location: SourceLocation | null,
    nameHint: string | null,
    context: EvaluationContext,
  ): StaticValue {
    if (children.length === 1) {
      props.entries.push({ kind: "property", key: "children", value: children[0] });
    } else if (children.length > 1) {
      props.entries.push({ kind: "property", key: "children", value: listValue(children) });
    }
    const element = (elementType: StaticValue): StaticElementValue => ({
      kind: "element",
      type: toElementType(elementType, nameHint),
      key,
      props,
      location,
      environment: context.environment,
    });
    if (type.kind === "branch") {
      return branchValue(
        type.alternatives.map(element),
        type.reason,
        type.location,
        type.preferredIndex,
      );
    }
    return element(type);
  }

  private evaluateJsxElement(node: JSXElement, context: EvaluationContext): StaticValue {
    const { props, key } = this.evaluateJsxAttributes(node.openingElement.attributes, context);
    const type =
      this.getStyledJsxType(node.openingElement.name, props) ??
      this.evaluateJsxName(node.openingElement.name, context);
    const children = this.evaluateJsxChildren(node.children, context);
    return this.createElement(
      type,
      props,
      key,
      children,
      this.locate(context.module, node),
      this.describeJsxName(node.openingElement.name),
      context,
    );
  }

  // styled-jsx's compile step rewrites `<style jsx>` into its `JSXStyle`
  // component; the framework model supplies that component when it applies.
  private getStyledJsxType(name: JSXElementName, props: StaticObjectValue): StaticValue | null {
    if (name.type !== "JSXIdentifier" || name.name !== "style") return null;
    const hasJsxAttribute = props.entries.some(
      (entry) => entry.kind === "property" && entry.key === "jsx",
    );
    if (!hasJsxAttribute) return null;
    return this.externalValues?.(STYLED_JSX_SPECIFIER, "default") ?? null;
  }

  private evaluateJsxFragment(node: JSXFragment, context: EvaluationContext): StaticValue {
    const children = this.evaluateJsxChildren(node.children, context);
    return this.createElement(
      { kind: "react-api", api: "Fragment" },
      objectValue(),
      null,
      children,
      this.locate(context.module, node),
      "Fragment",
      context,
    );
  }
}

interface ScopeSnapshot {
  scope: Scope;
  bindings: Map<string, StaticValue>;
}

const snapshotScopes = (scope: Scope): ScopeSnapshot[] => {
  const snapshots: ScopeSnapshot[] = [];
  let current: Scope | null = scope;
  while (current && current.parent) {
    snapshots.push({ scope: current, bindings: new Map(current.bindings) });
    current = current.parent;
  }
  return snapshots;
};

const restoreScopes = (snapshots: ScopeSnapshot[]): void => {
  for (const snapshot of snapshots) {
    snapshot.scope.bindings.clear();
    for (const [name, value] of snapshot.bindings) snapshot.scope.bindings.set(name, value);
  }
};

const joinScopes = (paths: ScopeSnapshot[][], reason: string, location: SourceLocation): void => {
  const [firstPath, ...otherPaths] = paths;
  firstPath.forEach((snapshot, scopeIndex) => {
    const siblings = otherPaths.map((path) => path[scopeIndex].bindings);
    const names = new Set([
      ...snapshot.bindings.keys(),
      ...siblings.flatMap((bindings) => [...bindings.keys()]),
    ]);
    snapshot.scope.bindings.clear();
    for (const name of names) {
      const values = [snapshot.bindings, ...siblings].map(
        (bindings) => bindings.get(name) ?? UNDEFINED_VALUE,
      );
      snapshot.scope.bindings.set(name, branchValue(values, reason, location));
    }
  });
};

/** `key in target` when the target's own keys are known; null when it depends on runtime shape. */
const hasProperty = (key: StaticValue, target: StaticValue): StaticValue | null => {
  if (key.kind !== "primitive") return null;
  const name = String(key.value);
  switch (target.kind) {
    case "branch": {
      const results: StaticValue[] = [];
      for (const alternative of target.alternatives) {
        const result = hasProperty(key, alternative);
        if (!result) return null;
        results.push(result);
      }
      return branchValue(results, target.reason, target.location, target.preferredIndex);
    }
    case "element":
      return REACT_ELEMENT_OWN_KEYS.has(name) ? TRUE_VALUE : FALSE_VALUE;
    case "object": {
      const keys = getKnownObjectKeys(target);
      if (keys?.includes(name)) return TRUE_VALUE;
      return keys && !OBJECT_PROTOTYPE_METHODS.has(name) ? FALSE_VALUE : null;
    }
    case "component-reference":
      return hasComponentProperty(target.type, name);
    case "primitive":
      return target.value === null || target.value === undefined
        ? { ...unknownValue(`"${name}" in ${String(target.value)}`), isThrown: true }
        : null;
    default:
      return null;
  }
};

const WRAPPER_SYMBOL_KEYS = {
  memo: "react.memo",
  "forward-ref": "react.forward_ref",
  lazy: "react.lazy",
} as const;

const hasComponentProperty = (type: StaticElementType, name: string): StaticValue | null => {
  switch (type.kind) {
    case "function":
    case "class":
      if (type.component.properties.has(name)) return TRUE_VALUE;
      return type.kind === "function" && !FUNCTION_OWN_KEYS.has(name) ? FALSE_VALUE : null;
    case "memo":
    case "forward-ref":
    case "lazy":
      return WRAPPER_OWN_KEYS[type.kind].has(name) ||
        type.properties.has(name) ||
        (name === "displayName" && type.displayName !== null)
        ? TRUE_VALUE
        : FALSE_VALUE;
    default:
      return null;
  }
};

const MAX_DISTRIBUTED_ALTERNATIVES = 16;

const countAlternatives = (value: StaticValue): number =>
  value.kind === "branch" ? value.alternatives.length : 1;

const applyBinaryOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue => {
  if (countAlternatives(left) * countAlternatives(right) <= MAX_DISTRIBUTED_ALTERNATIVES) {
    if (left.kind === "branch") {
      return mapValue(left, (alternative) => applyBinaryOperator(operator, alternative, right));
    }
    if (right.kind === "branch") {
      return mapValue(right, (alternative) => applyBinaryOperator(operator, left, alternative));
    }
  }
  if (left.kind === "primitive" && right.kind === "primitive") {
    const computed = computeBinary(operator, left.value, right.value);
    if (computed !== undefined) return computed;
  }
  const equality = compareEquality(operator, left, right);
  if (equality) return equality;
  switch (operator) {
    case "==":
    case "!=":
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "instanceof":
    case "in":
      return unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
    case "+": {
      const isString =
        (left.kind === "primitive" && typeof left.value === "string") ||
        (right.kind === "primitive" && typeof right.value === "string") ||
        (left.kind === "unknown-primitive" && left.primitiveType === "string") ||
        (right.kind === "unknown-primitive" && right.primitiveType === "string");
      return unknownPrimitiveValue(isString ? "string" : "any", "+ on dynamic values");
    }
    default:
      return unknownPrimitiveValue("number", `${operator} on dynamic values`);
  }
};

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

/** Loose equality only differs from identity when both sides can coerce; null, undefined and symbols never do. */
const mayCoerce = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? value.value !== null && value.value !== undefined
    : value.kind !== "symbol";

/**
 * React's memo cache sentinel never reaches application values, so comparing
 * it against anything the interpreter cannot see is still a definite answer.
 */
const compareEquality = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  if (!EQUALITY_OPERATORS.has(operator)) return null;
  const isStrict = operator === "===" || operator === "!==";
  let isEqual = compareIdentity(left, right);
  if (isEqual === false && !isStrict && mayCoerce(left) && mayCoerce(right)) isEqual = null;
  if (isEqual === null) {
    const isSentinel = (value: StaticValue): boolean =>
      value.kind === "symbol" && value.key === REACT_MEMO_CACHE_SENTINEL_KEY;
    if (!isSentinel(left) && !isSentinel(right)) return null;
    isEqual = false;
  }
  return primitiveValue(operator === "===" || operator === "==" ? isEqual : !isEqual);
};

const computeBinary = (
  operator: string,
  left: StaticPrimitive,
  right: StaticPrimitive,
): StaticValue | undefined => {
  switch (operator) {
    case "===":
      return primitiveValue(left === right);
    case "!==":
      return primitiveValue(left !== right);
    case "==":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left == right);
    case "!=":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left != right);
    default:
      break;
  }
  if (typeof left === "bigint" || typeof right === "bigint") return undefined;
  if (typeof left === "string" || typeof right === "string") {
    if (operator === "+") return primitiveValue(String(left) + String(right));
  }
  if (typeof left === "string" && typeof right === "string") {
    switch (operator) {
      case "<":
        return primitiveValue(left < right);
      case "<=":
        return primitiveValue(left <= right);
      case ">":
        return primitiveValue(left > right);
      case ">=":
        return primitiveValue(left >= right);
      default:
        break;
    }
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  switch (operator) {
    case "+":
      return primitiveValue(leftNumber + rightNumber);
    case "-":
      return primitiveValue(leftNumber - rightNumber);
    case "*":
      return primitiveValue(leftNumber * rightNumber);
    case "/":
      return primitiveValue(leftNumber / rightNumber);
    case "%":
      return primitiveValue(leftNumber % rightNumber);
    case "**":
      return primitiveValue(leftNumber ** rightNumber);
    case "<":
      return primitiveValue(leftNumber < rightNumber);
    case "<=":
      return primitiveValue(leftNumber <= rightNumber);
    case ">":
      return primitiveValue(leftNumber > rightNumber);
    case ">=":
      return primitiveValue(leftNumber >= rightNumber);
    default:
      return undefined;
  }
};
