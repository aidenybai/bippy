import type {
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  ManualMemoDependency,
  ObjectPropertyKey,
  Place,
  SourceLocation,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource, getHookKind } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { SourceFileResolver } from "./source-file-resolver";
import { ArrayIteration, ITERATION_METHODS, RENDERED_ITERATION_METHODS } from "./array-iteration";
import { CallbackPasser } from "./callback-passer";
import { ClaimRecorder } from "./claim-recorder";
import { ControlFlowWalker, createFunctionScope } from "./control-flow-walker";
import { Destructurer } from "./destructurer";
import { MutationTracker } from "./mutation-tracker";
import { PatternMatcher } from "./pattern-matcher";
import type { BranchOperator } from "./control-flow-walker";
import { ROOT_WALK_STATE, getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";
import type {
  ArrayExpressionValue,
  Binding,
  BindingKind,
  BindingPlace,
  BindingValue,
  Branch,
  Claim,
  ContextSetterFields,
  DerivedString,
  DispatchValue,
  Domain,
  FunctionValue,
  HookResultValue,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  LengthLimit,
  NumberRange,
  ObjectExpressionValue,
  ProvidedContext,
  Sample,
  SetterValue,
  StoreActions,
  SymbolicValue,
  WarningKind,
} from "./types";
import { formatPlace, formatSymbolicValue } from "./format";
import { flattenArrayChildren } from "./utils/flatten-array-children";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { EVENT_ARGUMENT, isHandlerProp } from "./collect-handlers";
import { PlaceMap } from "./utils/place-map";
import { getBindingPlace } from "./utils/get-binding-place";
import { getClampRange } from "./utils/get-clamp-range";
import { getClosureMutatedLocals } from "./utils/get-closure-mutated-locals";
import { isRefOnlyRead } from "./utils/is-ref-only-read";
import { getDeclarationLocation } from "./utils/get-declaration-location";
import { applyStringMethod, isStringMethod } from "./utils/string-methods";
import { getValueKey } from "./utils/get-value-key";
import { getValuePlace } from "./utils/get-value-place";
import { isExternalSource } from "./utils/is-external-source";
import { isNullish } from "./utils/is-nullish";
import { isNullishValue } from "./utils/is-nullish-value";
import { isPlacePrefix } from "./utils/is-place-prefix";
import { getTestExpression } from "./utils/get-test-expression";
import { coerceBooleanCall } from "./utils/coerce-boolean-call";
import { negate } from "./utils/negate";
import {
  EMPTY_STRING_VALUE,
  ONE_VALUE,
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  foldUnary,
  getContainedValues,
  getPassedCallbacks,
  isStartTransition,
} from "./symbolic-values";
import { BindingTable } from "./binding-table";
import type { BindingOptions } from "./binding-table";
import { buildJsx } from "./build-jsx";
import { Diagnostics } from "./diagnostics";
import { EffectCollector } from "./effect-collector";
import type { CollectedEffects } from "./effect-collector";
import { ExternalSources, getStoreFieldValue } from "./external-sources";
import { Cells } from "./cells";
import { FunctionRegistry } from "./function-registry";
import type { ModuleConstantLoader } from "./module-constants";
import type { CapturedValue, ModuleFunctionLoader } from "./function-registry";
import { NO_STOPS } from "./control-flow";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getPlaceOrSpread } from "./utils/get-place-or-spread";
import {
  getStoredContextPlaces,
  getWrittenContextPlaces,
} from "./utils/get-written-context-places";

export type InstructionValueOfKind<Kind extends InstructionValue["kind"]> = Extract<
  InstructionValue,
  { kind: Kind }
>;

interface InterpreterBindingOptions extends BindingOptions {
  resolver?: SourceFileResolver;
}

interface EffectCall {
  hookKind: HookKind;
  callback: SymbolicValue;
  callbackArguments: SymbolicValue[];
  dependencies: string | null;
  dependencyPlaces: BindingPlace[] | null;
  loc: SourceLocation;
}

interface CallSite {
  callee: SymbolicValue;
  calleePlace: Place;
  argumentValues: SymbolicValue[];
  argumentPlaces: Place[];
  loc: SourceLocation;
}

interface CompilationTables {
  values: Map<IdentifierId, SymbolicValue>;
  propertyNames: Map<IdentifierId, string>;
  propertyObjects: Map<IdentifierId, Place>;
  branchOperators: Map<BlockId, BranchOperator>;
  aliasSources: Map<IdentifierId, Place>;
  elementSources: Map<IdentifierId, Place>;
}

type CallTarget =
  | { kind: "Portal"; children: SymbolicValue }
  | { kind: "ProjectHook"; projectHook: ProjectHook }
  | { kind: "Store"; storeKey: string; storeActions: StoreActions }
  | { kind: "Hook"; hookKind: HookKind }
  | { kind: "ModuleFunction"; hirFunction: HIRFunction }
  | { kind: "Transition" }
  | { kind: "Value" };

export interface ProjectHook {
  hirFunction: HIRFunction;
  resolver: SourceFileResolver;
  loadModuleFunction: ModuleFunctionLoader;
}

export interface ProjectHookLoader {
  (declarationKey: string): ProjectHook | null;
}

export interface ProjectLoaders {
  loadProjectHook: ProjectHookLoader;
  loadProjectFunction: ProjectHookLoader;
  loadMutatedParameters: (declarationKey: string) => Set<number>;
}

const BOUND_CALLEES = new Set(["Function", "Setter", "Dispatch", "Bound"]);

const MAX_INLINE_DEPTH = 4;
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const SHORTENING_METHODS = new Set(["filter", "slice"]);
const LENGTH_PRESERVING_METHODS = new Set(["toReversed", "toSorted", "with"]);

const SUSPENDED_DOMAIN: Domain = {
  kind: "Cases",
  cases: [
    { kind: "Literal", value: true },
    { kind: "Literal", value: false },
  ],
  origin: "type",
};

const createFieldUpdate = (
  binding: Binding,
  properties: ObjectExpressionValue["properties"],
): ObjectExpressionValue => ({
  kind: "ObjectExpression",
  properties,
  spreads: [createBindingValue(binding)],
});

const INVOKABLE_KINDS = new Set<SymbolicValue["kind"]>([
  "Function",
  "Setter",
  "Dispatch",
  "Conditional",
]);

const getInvokedArguments = (
  methodName: string,
  argumentValues: SymbolicValue[],
): SymbolicValue[] | null => {
  const [, ...callArguments] = argumentValues;
  if (methodName === "call") return callArguments;
  if (methodName !== "apply") return null;
  const [applied] = callArguments;
  if (applied === undefined) return [];
  return applied.kind === "ArrayExpression" && applied.spreads.length === 0
    ? applied.elements
    : null;
};

const BUILTIN_MUTATOR_TARGETS = new Map<string, number>([
  ["Object.assign", 0],
  ["Object.defineProperty", 0],
  ["Object.defineProperties", 0],
  ["Object.setPrototypeOf", 0],
  ["Reflect.set", 0],
  ["Reflect.defineProperty", 0],
  ["Reflect.deleteProperty", 0],
  ["Reflect.setPrototypeOf", 0],
]);

const PROTOTYPE_MUTATOR_CALL =
  /^Array\.prototype\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\.(call|apply)$/;

const getLiteralEntries = (
  value: SymbolicValue,
): Array<[string | number, SymbolicValue]> | null => {
  if (value.kind === "ArrayExpression" && value.spreads.length === 0)
    return value.elements.map((element, index) => [index, element]);
  if (value.kind === "ObjectExpression" && value.spreads.length === 0)
    return value.properties.map((property) => [property.key, property.value]);
  return null;
};

const getCalleeName = (callSite: CallSite, target: CallTarget): string | null =>
  callSite.callee.kind === "Global"
    ? callSite.callee.name
    : target.kind === "ModuleFunction"
      ? target.hirFunction.id
      : null;

const getRefCellKey = (binding: Binding): string => `ref:${binding.id}`;

const getContextCellKey = (place: Place): string => `context:${place.identifier.id}`;

const isRefCell = (object: SymbolicValue, property: string): object is BindingValue =>
  object.kind === "Binding" &&
  object.binding.kind === "ref" &&
  object.path.length === 0 &&
  property === "current";

const getArrayLiteralMember = (
  array: ArrayExpressionValue,
  property: string,
  loc: SourceLocation,
): SymbolicValue => {
  if (property === "length") return { kind: "Primitive", value: array.elements.length };
  const index = Number(property);
  const isArrayIndex = Number.isInteger(index) && index >= 0 && String(index) === property;
  if (!isArrayIndex) return createUnknown("member", loc);
  return array.elements[index] ?? UNDEFINED_VALUE;
};

const getGlobalValue = (loadGlobal: InstructionValueOfKind<"LoadGlobal">): SymbolicValue => {
  const { binding } = loadGlobal;
  if (binding.kind === "Global" && binding.name === "undefined") return UNDEFINED_VALUE;
  return {
    kind: "Global",
    name: binding.name,
    module: "module" in binding ? binding.module : null,
  };
};

const getReturnedFunctions = (value: SymbolicValue): SymbolicValue[] => {
  if (value.kind === "Conditional")
    return [...getReturnedFunctions(value.consequent), ...getReturnedFunctions(value.alternate)];
  return value.kind === "Function" ? [value] : [];
};

export class Interpreter {
  #resolver: SourceFileResolver;
  readonly #projectLoaders: ProjectLoaders;
  readonly #loadModuleConstant: ModuleConstantLoader;
  readonly #tablesByEnvironment = new WeakMap<object, CompilationTables>();
  readonly #functions = new FunctionRegistry();
  readonly walker = new ControlFlowWalker(this);
  readonly mutations = new MutationTracker(this);
  readonly destructurer = new Destructurer(this);
  readonly claimRecorder = new ClaimRecorder(this);
  readonly callbacks = new CallbackPasser(this);
  cells = new Cells();
  readonly #memoDependencies = new Map<number, Array<ManualMemoDependency> | null>();
  readonly iteration = new ArrayIteration(this);
  readonly patterns = new PatternMatcher(this);
  readonly bindingTable = new BindingTable();
  readonly externalSources: ExternalSources;
  readonly diagnostics = new Diagnostics();
  readonly effectCalls: EffectCall[] = [];
  readonly decidedBranchOutcomes = new Map<string, boolean[]>();
  readonly #renderPhaseEffects = new EffectCollector((kind, message, loc) =>
    this.warn(kind, message, loc),
  );
  readonly renderedComponents = new Set<string>();
  readonly #wrappedCallbacks = new WeakMap<SymbolicValue, SymbolicValue[]>();
  readonly #wrappedCallbacksByBinding = new Map<number, SymbolicValue[]>();
  #wholePropsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  #handlerEffects: EffectCollector | null = null;
  #currentFunction: HIRFunction | null = null;
  readonly #inlinedFunctions = new Set<HIRFunction>();
  readonly #mountClosureIds = new Set<number>();
  readonly #closureMutatedLocals = new WeakMap<HIRFunction, Map<IdentifierId, Place>>();
  readonly #frameClosureIds: number[][] = [];
  readonly #bindingScopes: string[] = [];

  constructor(
    resolver: SourceFileResolver,
    loadModuleFunction: ModuleFunctionLoader,
    loadModuleConstant: ModuleConstantLoader,
    projectLoaders: ProjectLoaders,
    contextSetterFields: ContextSetterFields,
    actionsByStore: Map<string, StoreActions>,
  ) {
    this.#resolver = resolver;
    this.#loadModuleConstant = loadModuleConstant;
    this.#functions.addModule(resolver, loadModuleFunction);
    this.#projectLoaders = projectLoaders;
    this.externalSources = new ExternalSources(contextSetterFields, actionsByStore);
  }

  get functions(): FunctionRegistry {
    return this.#functions;
  }

  get resolver(): SourceFileResolver {
    return this.#resolver;
  }

  get handlerEffects(): EffectCollector | null {
    return this.#handlerEffects;
  }

  get claims(): Claim[] {
    return this.claimRecorder.claims;
  }

  get wholePropsSample(): Sample | null {
    return this.#wholePropsSample ?? this.destructurer.restPropsSample;
  }

  evaluateComponent(hirFunction: HIRFunction): SymbolicValue {
    this.walker.blockVisits = 0;
    return this.#evaluateFunction(hirFunction, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  finishRenderPhaseEffects(): CollectedEffects {
    return this.#renderPhaseEffects.finish();
  }

  collectEffects(
    callback: SymbolicValue,
    argumentValues: SymbolicValue[],
    renderGuards: SymbolicValue[] = [],
    guards: SymbolicValue[] = [],
    runsCleanup = false,
  ): CollectedEffects {
    const previousEffects = this.#handlerEffects;
    const previousBlockVisits = this.walker.blockVisits;
    const handlerEffects = new EffectCollector((kind, message, loc) =>
      this.warn(kind, message, loc),
    );
    this.#handlerEffects = handlerEffects;
    this.cells = new Cells();
    this.walker.blockVisits = 0;
    try {
      const callbacks = getContainedValues(callback);
      const walkState = { ...ROOT_WALK_STATE, renderGuards, guards };
      for (const handlerCallback of callbacks) {
        const returned = runsCleanup
          ? this.#getReturnedValue(handlerCallback, argumentValues, walkState)
          : null;
        const cleanups = returned ? getReturnedFunctions(returned) : [];
        const updateCountBeforeCleanup = handlerEffects.updateCount;
        const cleanupWalkState =
          returned?.kind === "Function"
            ? walkState
            : {
                ...walkState,
                guards: [...walkState.guards, createUnknown("previous-render", GeneratedSource)],
              };
        for (const cleanup of cleanups) this.#runCallback(cleanup, [], new Set(), cleanupWalkState);
        handlerEffects.forgetRenderValues(updateCountBeforeCleanup);
        this.#runCallback(handlerCallback, argumentValues, new Set(), walkState);
      }
      this.forgetHandlerWrites(callback);
      if (callback.kind === "Unknown")
        for (const binding of this.bindingTable.bindings)
          if (isExternalSource(binding))
            this.#recordExternalUpdate(
              handlerEffects,
              createBindingValue(binding),
              ROOT_WALK_STATE,
            );
      return handlerEffects.finish();
    } finally {
      this.#handlerEffects = previousEffects;
      this.walker.blockVisits = previousBlockVisits;
    }
  }

  #getReturnedValue(
    callback: SymbolicValue,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
  ): SymbolicValue | null {
    const handlerEffects = this.#handlerEffects;
    this.#handlerEffects = new EffectCollector(() => {});
    try {
      return this.#runCallback(callback, argumentValues, new Set(), walkState);
    } finally {
      this.#handlerEffects = handlerEffects;
    }
  }

  #getUpdateCollector(): EffectCollector {
    return this.#handlerEffects ?? this.#renderPhaseEffects;
  }

  #registerFunction(hirFunction: HIRFunction, isSnapshot = false): FunctionValue {
    return this.#functions.register(hirFunction, this.#resolver, isSnapshot);
  }

  #bindMutatedMemo(finish: InstructionValueOfKind<"FinishMemoize">): void {
    const memoized = this.read(finish.decl);
    if (memoized.kind !== "ObjectExpression" && memoized.kind !== "ArrayExpression") return;
    const local = this.#getClosureMutatedLocals().get(finish.decl.identifier.id);
    if (!local) return;
    const binding = this.createBinding(
      getIdentifierName(local) ?? "memo",
      "memo",
      getDeclarationLocation(local),
      { hookKind: "useMemo", initial: memoized },
    );
    this.write(finish.decl, createBindingValue(binding));
  }

  #getClosureMutatedLocals(): Map<IdentifierId, Place> {
    const hirFunction = this.getCurrentFunction();
    const cached = this.#closureMutatedLocals.get(hirFunction);
    if (cached) return cached;
    const locals = getClosureMutatedLocals(hirFunction);
    this.#closureMutatedLocals.set(hirFunction, locals);
    return locals;
  }

  #createClosure(hirFunction: HIRFunction): FunctionValue {
    const isInlined = this.#inlinedFunctions.size > 0;
    const closure = this.#registerFunction(hirFunction, isInlined);
    if (!isInlined) return closure;
    this.#functions.setCapturedValues(
      closure.functionId,
      hirFunction.context.map((place): CapturedValue => [place, this.read(place)]),
    );
    this.#frameClosureIds.at(-1)?.push(closure.functionId);
    return closure;
  }

  #applyCapturedValues(functionId: number | null): () => void {
    const isCreatingFrameActive =
      functionId !== null &&
      this.#frameClosureIds.some((closureIds) => closureIds.includes(functionId));
    const capturedValues = isCreatingFrameActive
      ? []
      : this.#functions.getCapturedValues(functionId);
    const liveValues = capturedValues.map(([place]): CapturedValue => [place, this.read(place)]);
    for (const [place, value] of capturedValues) this.write(place, value);
    return () => {
      for (const [place, value] of liveValues) this.write(place, value);
    };
  }

  getCurrentFunction(): HIRFunction {
    if (!this.#currentFunction) throw new Error("No function is being evaluated");
    return this.#currentFunction;
  }

  createBinding(
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: InterpreterBindingOptions = {},
  ): Binding {
    return this.bindingTable.createBinding(options.resolver ?? this.#resolver, name, kind, loc, {
      scope: this.#bindingScopes.join(">"),
      ...options,
    });
  }

  withBindingScope<Result>(scope: string, run: () => Result): Result {
    this.#bindingScopes.push(scope);
    try {
      return run();
    } finally {
      this.#bindingScopes.pop();
    }
  }

  readField(binding: Binding, path: string[], loc: SourceLocation): BindingValue {
    return this.bindingTable.readField(this.#resolver, binding, path, loc);
  }

  getCompilationTables(hirFunction: HIRFunction = this.getCurrentFunction()): CompilationTables {
    const { env } = hirFunction;
    const compilationTables = this.#tablesByEnvironment.get(env) ?? {
      values: new Map(),
      propertyNames: new Map(),
      propertyObjects: new Map(),
      branchOperators: new Map(),
      aliasSources: new Map(),
      elementSources: new Map(),
    };
    this.#tablesByEnvironment.set(env, compilationTables);
    return compilationTables;
  }

  read(place: Place): SymbolicValue {
    return (
      this.getCompilationTables().values.get(place.identifier.id) ??
      createUnknown("free-variable", place.loc)
    );
  }

  write(place: Place, value: SymbolicValue): void {
    this.getCompilationTables().values.set(place.identifier.id, value);
  }

  getPropBinding(propName: string, localName: string, loc: SourceLocation): Binding {
    return this.bindingTable.getPropBinding(this.#resolver, propName, localName, loc);
  }

  #foldLiteralType(value: SymbolicValue, loc: SourceLocation): SymbolicValue {
    if (value.kind !== "Global") return value;
    const domain = this.#resolver.getDomain(loc);
    const [onlyCase] = domain.kind === "Cases" ? domain.cases : [];
    return domain.kind === "Cases" && domain.cases.length === 1 && onlyCase?.kind === "Literal"
      ? { kind: "Primitive", value: onlyCase.value }
      : value;
  }

  evaluatePropertyLoad(
    object: SymbolicValue,
    property: string,
    loc: SourceLocation,
  ): SymbolicValue {
    switch (object.kind) {
      case "Binding":
        return this.readField(object.binding, [...object.path, property], loc);
      case "Props":
        return createBindingValue(this.getPropBinding(property, property, loc));
      case "ObjectExpression":
        return (
          object.properties.findLast((candidate) => candidate.key === property)?.value ??
          (object.spreads.length > 0 ? createUnknown("spread", loc) : UNDEFINED_VALUE)
        );
      case "ArrayExpression":
        return object.spreads.length === 0
          ? getArrayLiteralMember(object, property, loc)
          : createUnknown("member", loc);
      case "Primitive":
        return property === "length" && typeof object.value === "string"
          ? { kind: "Primitive", value: object.value.length }
          : createUnknown("member", loc);
      case "Global":
        return { kind: "Global", name: `${object.name}.${property}`, module: object.module };
      case "Conditional":
        if (isNullishValue(object.alternate))
          return this.evaluatePropertyLoad(object.consequent, property, loc);
        if (isNullishValue(object.consequent))
          return this.evaluatePropertyLoad(object.alternate, property, loc);
        return {
          ...object,
          consequent: this.evaluatePropertyLoad(object.consequent, property, loc),
          alternate: this.evaluatePropertyLoad(object.alternate, property, loc),
        };
      default:
        return createUnknown("member", loc);
    }
  }

  #getJsxTag(tag: InstructionValueOfKind<"JsxExpression">["tag"]): SymbolicValue {
    if (tag.kind === "BuiltinTag") return { kind: "Primitive", value: tag.name };
    return this.read(tag);
  }

  #buildSuspense(element: JsxExpressionValue, terminalId: InstructionId): SymbolicValue {
    const fallback = element.props.find(
      (prop) => prop.kind === "JsxAttribute" && prop.name === "fallback",
    );
    const suspendedBinding = this.createBinding("suspended", "suspense", element.loc, {
      domain: SUSPENDED_DOMAIN,
    });
    return {
      kind: "Conditional",
      test: createBindingValue(suspendedBinding),
      testKind: "truthy",
      consequent: { ...element, children: [fallback?.value ?? UNDEFINED_VALUE] },
      alternate: element,
      branch: this.createBranch(terminalId, element.loc, "none"),
      guardKeys: [],
    };
  }

  callFunction(
    callee: FunctionValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    const hirFunction = this.#functions.get(callee.functionId);
    if (
      !hirFunction ||
      this.#inlinedFunctions.size >= MAX_INLINE_DEPTH ||
      this.#inlinedFunctions.has(hirFunction)
    )
      return createUnknown("call", loc);
    this.#inlinedFunctions.add(hirFunction);
    try {
      return this.#evaluateCallee(hirFunction, argumentValues, walkState, callee.functionId);
    } finally {
      this.#inlinedFunctions.delete(hirFunction);
    }
  }

  #evaluateCallee(
    hirFunction: HIRFunction,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
    functionId: number,
  ): SymbolicValue {
    const updateCount = this.#handlerEffects?.updateCount ?? 0;
    const result = this.#evaluateFunction(hirFunction, argumentValues, walkState, functionId);
    if (this.#mountClosureIds.has(functionId))
      this.#handlerEffects?.forgetRenderValues(updateCount);
    return result;
  }

  resolveModuleFunction(value: SymbolicValue): SymbolicValue {
    if (value.kind !== "Global") return value;
    const moduleFunction = this.#functions.loadModuleFunction(this.#resolver, value.name);
    return moduleFunction ? this.#registerFunction(moduleFunction) : value;
  }

  warn(kind: WarningKind, message: string, loc: SourceLocation, prop: string | null = null): void {
    this.diagnostics.warn(kind, message, loc, this.#resolver.fileName, prop);
  }

  #getSetterNextValue(
    setterArgument: SymbolicValue | undefined,
    previousValue: SymbolicValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    return setterArgument?.kind === "Function"
      ? this.callFunction(setterArgument, [previousValue], loc, walkState)
      : (setterArgument ?? UNDEFINED_VALUE);
  }

  #applySetter(
    setter: SetterValue,
    setterArgument: SymbolicValue | undefined,
    walkState: WalkState,
  ): void {
    const collector = this.#getUpdateCollector();
    const nextValue = this.#getSetterNextValue(
      setterArgument,
      collector.getQueuedValue(setter.binding, walkState),
      setter.binding.loc,
      walkState,
    );
    collector.recordSetterCall(setter.binding, nextValue, walkState);
  }

  #applyDispatch(
    dispatch: DispatchValue,
    action: SymbolicValue | undefined,
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const { reducer, pending } = dispatch;
    const isAsyncAction =
      reducer.kind === "Function" && (this.#functions.get(reducer.functionId)?.async ?? false);
    const collector = this.#getUpdateCollector();
    const nextValue =
      reducer.kind === "Function"
        ? this.callFunction(
            reducer,
            [collector.getQueuedValue(dispatch.binding, walkState), action ?? UNDEFINED_VALUE],
            loc,
            walkState,
          )
        : createUnknown("dispatch", loc);
    const settledWalkState = isAsyncAction ? getAsyncWalkState(walkState) : walkState;
    if (pending && isAsyncAction)
      collector.recordSetterCall(pending, { kind: "Primitive", value: true }, walkState);
    collector.recordSetterCall(dispatch.binding, nextValue, settledWalkState);
    if (pending && isAsyncAction)
      collector.recordSetterCall(pending, { kind: "Primitive", value: false }, settledWalkState);
  }

  #recordWholeProps(callSite: CallSite): void {
    const propsIndex = callSite.argumentValues.findIndex((argument) => argument.kind === "Props");
    const propsPlace = callSite.argumentPlaces[propsIndex];
    if (propsPlace) this.#wholePropsSample ??= this.#resolver.getSamples(propsPlace.loc)[0] ?? null;
  }

  #getCallTarget(callSite: CallSite): CallTarget {
    const [firstArgument] = callSite.argumentValues;
    const reactExportName = this.#resolver.getReactExportName(callSite.loc);
    if (reactExportName === "createPortal" && firstArgument)
      return { kind: "Portal", children: firstArgument };
    if (reactExportName === "startTransition" || isStartTransition(callSite.callee))
      return { kind: "Transition" };
    const hookKind = getHookKind(this.getCurrentFunction().env, callSite.calleePlace.identifier);
    if (hookKind === "Custom") {
      const projectHook = this.#findProjectHook(callSite.calleePlace);
      if (projectHook)
        return this.#inlinedFunctions.size < MAX_INLINE_DEPTH
          ? { kind: "ProjectHook", projectHook }
          : { kind: "Hook", hookKind };
      const storeKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
      const storeActions = storeKey ? this.externalSources.getStoreActions(storeKey) : undefined;
      if (storeKey && storeActions) return { kind: "Store", storeKey, storeActions };
    }
    if (hookKind !== null) return { kind: "Hook", hookKind };
    const helperTakingCallbacks =
      callSite.callee.kind === "Global" && getPassedCallbacks(callSite.argumentValues).length > 0
        ? this.#functions.loadModuleFunction(this.#resolver, callSite.callee.name)
        : null;
    if (helperTakingCallbacks)
      return { kind: "ModuleFunction", hirFunction: helperTakingCallbacks };
    const declarationKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
    const isPureHandlerCall =
      this.#handlerEffects !== null &&
      callSite.callee.kind === "Global" &&
      this.#inlinedFunctions.size < MAX_INLINE_DEPTH &&
      declarationKey !== null &&
      this.#projectLoaders.loadMutatedParameters(declarationKey).size === 0;
    const handlerHelper = isPureHandlerCall
      ? this.#projectLoaders.loadProjectFunction(declarationKey)
      : null;
    if (!handlerHelper) return { kind: "Value" };
    this.#functions.addModule(
      handlerHelper.resolver,
      handlerHelper.loadModuleFunction,
      handlerHelper.hirFunction,
    );
    return { kind: "ModuleFunction", hirFunction: handlerHelper.hirFunction };
  }

  #readStore(
    storeKey: string,
    storeActions: StoreActions,
    callSite: CallSite,
    walkState: WalkState,
  ): SymbolicValue {
    const storeHookName = callSite.callee.kind === "Global" ? callSite.callee.name : "store";
    const storeBinding = this.externalSources.getStoreBinding(storeKey, storeActions, () =>
      this.createBinding(`${storeHookName}()`, "hook", callSite.loc, {
        hookKind: "Custom",
        domain: { kind: "Opaque", typeText: storeHookName },
      }),
    );
    const [selector] = callSite.argumentValues;
    return selector?.kind === "Function"
      ? this.callFunction(selector, [createBindingValue(storeBinding)], callSite.loc, walkState)
      : createBindingValue(storeBinding);
  }

  #findProjectFunction(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#projectLoaders.loadProjectFunction(declarationKey) : null;
  }

  #findProjectHook(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#projectLoaders.loadProjectHook(declarationKey) : null;
  }

  #evaluateCall(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee, argumentValues } = callSite;
    const modeled =
      this.patterns.start(callee, argumentValues, callSite.loc) ??
      coerceBooleanCall(callee, argumentValues) ??
      this.iteration.evaluateArrayFrom(callee, argumentValues, callSite.loc, walkState);
    if (modeled) return modeled;
    this.#recordWholeProps(callSite);
    const target = this.#getCallTarget(callSite);
    this.claimRecorder.recordInvariant(
      getCalleeName(callSite, target),
      callSite.argumentValues,
      callSite.loc,
      walkState,
    );
    switch (target.kind) {
      case "Portal":
        return target.children;
      case "ProjectHook": {
        this.#functions.addModule(
          target.projectHook.resolver,
          target.projectHook.loadModuleFunction,
          target.projectHook.hirFunction,
        );
        const position = callSite.loc === GeneratedSource ? "generated" : callSite.loc.start.index;
        return this.withBindingScope(`${this.#resolver.fileName}:${position}`, () =>
          this.#inlineFunction(target.projectHook.hirFunction, callSite, walkState),
        );
      }
      case "Store":
        return this.#readStore(target.storeKey, target.storeActions, callSite, walkState);
      case "Hook":
        return this.#evaluateHookCall(target.hookKind, callSite, walkState);
      case "ModuleFunction":
        return this.#inlineFunction(target.hirFunction, callSite, walkState);
      case "Transition":
        return this.#startTransition(callSite, walkState);
      case "Value":
        return this.#callValue(callSite, walkState);
      default:
        return assertExhaustive(target, "Unhandled call target");
    }
  }

  #inlineFunction(
    hirFunction: HIRFunction,
    callSite: CallSite,
    walkState: WalkState,
  ): SymbolicValue {
    return this.callFunction(
      this.#registerFunction(hirFunction),
      callSite.argumentValues,
      callSite.loc,
      walkState,
    );
  }

  #startTransition(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const [scope] = callSite.argumentValues;
    if (scope) this.#callValue({ ...callSite, callee: scope, argumentValues: [] }, walkState);
    return UNDEFINED_VALUE;
  }

  #callValue(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee } = callSite;
    const [firstArgument] = callSite.argumentValues;
    switch (callee.kind) {
      case "Function":
        return this.callFunction(callee, callSite.argumentValues, callSite.loc, walkState);
      case "Conditional": {
        const test = getTestExpression(callee);
        return {
          ...callee,
          consequent: this.#evaluateCall(
            { ...callSite, callee: callee.consequent },
            { ...walkState, guards: [...walkState.guards, test] },
          ),
          alternate: this.#evaluateCall(
            { ...callSite, callee: callee.alternate },
            { ...walkState, guards: [...walkState.guards, negate(test)] },
          ),
        };
      }
      case "Setter":
        this.#applySetter(callee, firstArgument, walkState);
        return UNDEFINED_VALUE;
      case "Dispatch":
        this.#applyDispatch(callee, firstArgument, callSite.loc, walkState);
        return UNDEFINED_VALUE;
      case "Bound":
        return this.#evaluateCall(
          {
            ...callSite,
            callee: callee.callee,
            argumentValues: [...callee.argumentValues, ...callSite.argumentValues],
          },
          walkState,
        );
      default:
        return this.#callOpaqueValue(callSite, walkState);
    }
  }

  #callOpaqueValue(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee, argumentValues, loc } = callSite;
    this.#trackProjectCallMutations(callSite);
    this.#trackBuiltinMutation(callSite);
    const isMutatingCall = !this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc);
    if (this.#handlerEffects && isMutatingCall && callee.kind === "Binding")
      this.#callBinding(callee, argumentValues, walkState);
    if (this.#handlerEffects || isMutatingCall)
      this.callbacks.passCallbacks(argumentValues, loc, walkState);
    if (this.#handlerEffects) return createUnknown("call", loc);
    this.#forgetCallbackWrites(argumentValues, loc);
    if (this.#resolver.isReactElement(loc)) {
      const helper = this.#findProjectFunction(callSite.calleePlace);
      if (helper && this.#inlinedFunctions.size < MAX_INLINE_DEPTH) {
        this.#functions.addModule(helper.resolver, helper.loadModuleFunction, helper.hirFunction);
        return this.#inlineFunction(helper.hirFunction, callSite, walkState);
      }
      this.diagnostics.bailOut("unknown-call", "call returns JSX the analysis can't see into", loc);
      return createUnknown("call", loc);
    }
    const result = this.#createCallResult(callSite);
    const callbacks = getPassedCallbacks(argumentValues);
    const isExternalWrapper = callee.kind === "Binding" && isExternalSource(callee.binding);
    const wrapped = isExternalWrapper ? [callee, ...callbacks] : callbacks;
    if (callbacks.length > 0) this.#wrappedCallbacks.set(result, wrapped);
    if (callbacks.length > 0 && result.kind === "Binding")
      this.#wrappedCallbacksByBinding.set(result.binding.id, wrapped);
    return result;
  }

  #trackProjectCallMutations(callSite: CallSite): void {
    const declarationKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
    if (!declarationKey) return;
    for (const index of this.#projectLoaders.loadMutatedParameters(declarationKey)) {
      const argumentPlace = callSite.argumentPlaces[index];
      if (argumentPlace) this.mutations.trackArgument(argumentPlace, callSite.loc);
    }
  }

  #trackBuiltinMutation(callSite: CallSite): void {
    const { callee } = callSite;
    if (callee.kind !== "Global" || callee.module !== null) return;
    const targetIndex =
      BUILTIN_MUTATOR_TARGETS.get(callee.name) ??
      (PROTOTYPE_MUTATOR_CALL.test(callee.name) ? 0 : null);
    const argumentPlace = targetIndex === null ? undefined : callSite.argumentPlaces[targetIndex];
    if (argumentPlace) this.mutations.trackArgument(argumentPlace, callSite.loc);
  }

  getWrappedCallbacks(value: SymbolicValue): SymbolicValue[] | null {
    const byBinding =
      value.kind === "Binding" ? this.#wrappedCallbacksByBinding.get(value.binding.id) : undefined;
    return this.#wrappedCallbacks.get(value) ?? byBinding ?? null;
  }

  forgetHandlerWrites(handlerCallback: SymbolicValue): void {
    for (const callback of getContainedValues(handlerCallback)) {
      if (callback.kind !== "Function") continue;
      const hirFunction = this.#functions.get(callback.functionId);
      if (!hirFunction) continue;
      const { values } = this.getCompilationTables(hirFunction);
      for (const place of getStoredContextPlaces(hirFunction))
        values.set(place.identifier.id, createUnknown("handler-write", callback.loc));
    }
  }

  #forgetCallbackWrites(argumentValues: SymbolicValue[], loc: SourceLocation): void {
    for (const callback of getPassedCallbacks(argumentValues)) {
      if (callback.kind !== "Function") continue;
      const hirFunction = this.#functions.get(callback.functionId);
      for (const place of hirFunction ? getWrittenContextPlaces(hirFunction) : [])
        this.write(place, createUnknown("callback-write", loc));
    }
  }

  #callBinding(callee: BindingValue, argumentValues: SymbolicValue[], walkState: WalkState): void {
    const { binding, path } = callee;
    if (binding.kind === "prop") this.#handlerEffects?.addDelegate(formatPlace(binding, path));
    const memberName = path.length === 1 ? path[0] : undefined;
    const setterField = memberName && this.externalSources.getSetterField(binding, memberName);
    if (setterField) {
      this.#setContextField(binding, setterField, argumentValues[0], walkState);
      return;
    }
    const assignments =
      memberName && this.externalSources.getActionAssignments(binding, memberName);
    if (assignments) {
      this.#handlerEffects?.recordSetterCall(
        binding,
        createFieldUpdate(
          binding,
          assignments.map((assignment) => ({
            key: assignment.field,
            value: getStoreFieldValue(binding, assignment, argumentValues),
          })),
        ),
        walkState,
      );
      return;
    }
    if (isExternalSource(binding) && this.#handlerEffects)
      this.#recordExternalUpdate(this.#handlerEffects, callee, walkState);
  }

  #setContextField(
    binding: Binding,
    field: string,
    setterArgument: SymbolicValue | undefined,
    walkState: WalkState,
  ): void {
    if (!this.#handlerEffects) return;
    const previousValue = createBindingValue(binding, [field]);
    const nextValue = this.#getSetterNextValue(
      setterArgument,
      previousValue,
      binding.loc,
      walkState,
    );
    this.#handlerEffects.addUpdate(
      binding,
      createFieldUpdate(binding, [
        { key: field, value: this.#handlerEffects.forgetMutatedBindings(nextValue) },
      ]),
      getAsyncWalkState(walkState),
    );
  }

  #recordExternalUpdate(
    handlerEffects: EffectCollector,
    callee: BindingValue,
    walkState: WalkState,
  ): void {
    handlerEffects.addDelegate(formatPlace(callee.binding, callee.path));
    const affectedBindings = this.bindingTable.bindings.filter(
      (binding) =>
        binding.id === callee.binding.id ||
        this.externalSources.isFromSameModule(callee.binding, binding),
    );
    for (const binding of affectedBindings)
      if (!handlerEffects.hasUpdate(binding))
        handlerEffects.addUpdate(
          binding,
          createUnknown("external", GeneratedSource),
          getAsyncWalkState(walkState),
        );
  }

  #finishMemoize(finish: InstructionValueOfKind<"FinishMemoize">): void {
    const dependencies = this.#memoDependencies.get(finish.manualMemoId);
    if (!dependencies) return;
    const memoized = this.read(finish.decl);
    const dependencyPlaces = new PlaceMap<true>();
    for (const dependency of dependencies) {
      if (dependency.root.kind !== "NamedLocal") continue;
      const root = this.read(dependency.root.value);
      if (root.kind !== "Binding") continue;
      const path = [...root.path, ...dependency.path.map((entry) => String(entry.property))];
      dependencyPlaces.set(getBindingPlace(root.binding, path), true);
    }
    if (memoized.kind === "Function") {
      this.#captureStaleReads(memoized, dependencyPlaces, finish.loc);
      return;
    }
    if (this.#isStaleMemo(memoized, dependencyPlaces))
      this.write(finish.decl, createUnknown("memo", finish.loc));
  }

  #captureStaleReads(
    callback: FunctionValue,
    dependencyPlaces: PlaceMap<true>,
    loc: SourceLocation,
  ): void {
    const context = this.#functions.get(callback.functionId)?.context ?? [];
    let hasStaleRead = false;
    const capturedValues = context.map((place): CapturedValue => {
      const value = this.read(place);
      if (!this.#isStaleMemo(value, dependencyPlaces)) return [place, value];
      hasStaleRead = true;
      return [place, createUnknown("memo", loc)];
    });
    if (hasStaleRead) this.#functions.setCapturedValues(callback.functionId, capturedValues);
  }

  #isStaleMemo(memoized: SymbolicValue, dependencyPlaces: PlaceMap<true>): boolean {
    const readPlaces = new PlaceMap<true>();
    this.collectInputPlaces(memoized, readPlaces);
    const bindingsById = new Map(
      this.bindingTable.bindings.map((binding) => [binding.id, binding]),
    );
    const isCovered = (place: BindingPlace, visited = new Set<number>()): boolean => {
      if (dependencyPlaces.places().some((dependency) => isPlacePrefix(dependency, place)))
        return true;
      const binding = bindingsById.get(place.bindingId);
      if (!binding || binding.kind === "ref" || visited.has(binding.id))
        return binding?.kind === "ref";
      visited.add(binding.id);
      return (
        (binding.kind === "call" || binding.kind === "loop") &&
        binding.inputPlaces.length > 0 &&
        binding.inputPlaces.every((inputPlace) => isCovered(inputPlace, visited))
      );
    };
    return readPlaces.places().some((place) => !isCovered(place));
  }

  collectInputPlaces(
    value: SymbolicValue,
    inputPlaces: PlaceMap<true>,
    visitedFunctionIds = new Set<number>(),
  ): void {
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") inputPlaces.set(getValuePlace(part), true);
      if (part.kind !== "Function" || visitedFunctionIds.has(part.functionId)) return;
      visitedFunctionIds.add(part.functionId);
      for (const capturedPlace of this.#functions.get(part.functionId)?.context ?? [])
        this.collectInputPlaces(this.read(capturedPlace), inputPlaces, visitedFunctionIds);
    });
  }

  #createDerivedValue(
    sourceValues: SymbolicValue[],
    reason: string,
    loc: SourceLocation,
  ): SymbolicValue {
    const inputPlaces = new PlaceMap<true>();
    for (const sourceValue of sourceValues) this.collectInputPlaces(sourceValue, inputPlaces);
    const sourceText = this.#resolver.getSourceText(loc);
    if (inputPlaces.size === 0 || sourceText === null) return createUnknown(reason, loc);
    return createBindingValue(
      this.createBinding(sourceText, "call", loc, { inputPlaces: inputPlaces.places() }),
    );
  }

  #getReceiverPlace(callee: SymbolicValue): BindingPlace | null {
    if (callee.kind !== "Binding" || callee.path.length === 0) return null;
    return getBindingPlace(callee.binding, callee.path.slice(0, -1));
  }

  #getLengthLimit(callSite: CallSite, receiverPlace: BindingPlace | null): LengthLimit | null {
    const methodName = callSite.callee.kind === "Binding" ? callSite.callee.path.at(-1) : undefined;
    if (!receiverPlace || methodName === undefined) return null;
    const isSameLength = LENGTH_PRESERVING_METHODS.has(methodName);
    const isLengthLimited = isSameLength || SHORTENING_METHODS.has(methodName);
    if (!isLengthLimited || !this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc))
      return null;
    return {
      arrayLength: { ...receiverPlace, path: [...receiverPlace.path, "length"] },
      isSameLength,
    };
  }

  #getRepeatableCallKey(callSite: CallSite): string | undefined {
    const isRepeatable =
      this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc) &&
      this.#resolver.hasPrimitiveType(callSite.loc);
    if (!isRepeatable) return undefined;
    return [callSite.callee, ...callSite.argumentValues].map(getValueKey).join(",");
  }

  #createCallResult(
    callSite: CallSite,
    {
      derived = null,
      range = null,
    }: { derived?: DerivedString | null; range?: NumberRange | null } = {},
  ): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(callSite.loc);
    if (calleeText === null) return createUnknown("call", callSite.loc);
    const inputPlaces = new PlaceMap<true>();
    for (const argument of callSite.argumentValues) this.collectInputPlaces(argument, inputPlaces);
    const receiverPlace = this.#getReceiverPlace(callSite.callee);
    const lengthLimit = this.#getLengthLimit(callSite, receiverPlace);
    const hasFiniteResult = this.#resolver.getDomain(callSite.loc).kind === "Cases";
    if (!lengthLimit && !derived && !range && inputPlaces.size === 0 && !hasFiniteResult)
      return createUnknown("call", callSite.loc);
    if (receiverPlace) inputPlaces.set(receiverPlace, true);
    const argumentText = callSite.argumentValues.map(formatSymbolicValue).join(", ");
    return createBindingValue(
      this.createBinding(`${calleeText}(${argumentText})`, "call", callSite.loc, {
        inputPlaces: inputPlaces.places(),
        lengthLimit,
        identityKey: this.#getRepeatableCallKey(callSite),
        derived,
        range,
      }),
    );
  }

  #evaluateHookCall(hookKind: HookKind, callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee, argumentValues, argumentPlaces, loc } = callSite;
    const [firstArgument, secondArgument] = argumentValues;
    if (EFFECT_HOOKS.has(hookKind)) {
      if (firstArgument)
        this.callbacks.addEffectCall(hookKind, firstArgument, argumentPlaces[1], loc);
      return UNDEFINED_VALUE;
    }
    if (hookKind === "Custom") this.callbacks.addDeferredCallbacks(argumentValues, loc);
    if (hookKind === "useImperativeHandle" && secondArgument?.kind === "Function")
      this.callbacks.addDeferredCallbacks(
        [this.callFunction(secondArgument, [], loc, walkState)],
        loc,
      );
    if (hookKind === "useMemo" && firstArgument?.kind === "Function")
      return this.callFunction(firstArgument, [], loc, walkState);
    if (hookKind === "useCallback" && firstArgument) return firstArgument;
    const hookName = callee.kind === "Global" ? callee.name : hookKind;
    const hookModule = callee.kind === "Global" ? callee.module : null;
    const hookResult: HookResultValue = {
      kind: "HookResult",
      hookKind,
      name: hookName,
      module: hookModule,
      argumentValues: this.#evaluateInitializers(hookKind, callSite, walkState),
      loc,
    };
    const [contextPlace] = argumentPlaces;
    const contextKey =
      hookKind === "useContext" && contextPlace
        ? this.#resolver.getDeclarationKey(contextPlace.loc)
        : null;
    this.externalSources.addHookResult(hookResult, this.#resolver, contextKey);
    return hookResult;
  }

  #evaluateInitializers(
    hookKind: HookKind,
    callSite: CallSite,
    walkState: WalkState,
  ): SymbolicValue[] {
    const { argumentValues, loc } = callSite;
    const [initializer, initialArgument, init] = argumentValues;
    if (hookKind === "useState" && initializer?.kind === "Function")
      return [this.callFunction(initializer, [], loc, walkState), ...argumentValues.slice(1)];
    if (hookKind === "useReducer" && init?.kind === "Function" && initializer && initialArgument)
      return [
        initializer,
        this.callFunction(init, [initialArgument], loc, walkState),
        ...argumentValues.slice(3),
      ];
    return argumentValues;
  }

  #evaluateMethodCall(
    methodCall: InstructionValueOfKind<"MethodCall">,
    instructionId: InstructionId,
    walkState: WalkState,
  ): SymbolicValue {
    const receiver = this.read(methodCall.receiver);
    const methodName = this.getPropertyName(methodCall.property) ?? "";
    const argumentPlaces = methodCall.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.read(place));
    const matched = this.patterns.continue(receiver, methodName, argumentValues, {
      loc: methodCall.loc,
      instructionId,
      walkState,
    });
    if (matched) return matched;
    const invokedArguments = INVOKABLE_KINDS.has(receiver.kind)
      ? getInvokedArguments(methodName, argumentValues)
      : null;
    if (invokedArguments)
      return this.#evaluateCall(
        {
          callee: receiver,
          calleePlace: methodCall.receiver,
          argumentValues: invokedArguments,
          argumentPlaces: methodName === "call" ? argumentPlaces.slice(1) : [],
          loc: methodCall.loc,
        },
        walkState,
      );
    const instance =
      receiver.kind === "Binding" && receiver.path.length === 0 && receiver.binding.initial
        ? receiver.binding.initial
        : receiver;
    const instanceCallbacks = this.#handlerEffects ? this.getWrappedCallbacks(instance) : null;
    if (instanceCallbacks)
      this.callbacks.passCallbacks(instanceCallbacks, methodCall.loc, walkState);
    const [callback] = argumentValues;
    if (ITERATION_METHODS.has(methodName))
      this.iteration.visitItemCallback(methodName, callback, methodCall, walkState);
    const isIteratingLiteral =
      this.#handlerEffects !== null &&
      ITERATION_METHODS.has(methodName) &&
      receiver.kind === "ArrayExpression" &&
      callback?.kind === "Function";
    const found = this.iteration.evaluateArrayFind(
      methodName,
      receiver,
      callback,
      instructionId,
      methodCall.loc,
      walkState,
    );
    if (found) return found;
    if (isIteratingLiteral) {
      this.iteration.callForEachItem(callback, receiver, methodCall.loc, walkState);
      return createUnknown("call", methodCall.loc);
    }
    if (RENDERED_ITERATION_METHODS.has(methodName) && callback?.kind === "Function")
      return this.iteration.evaluateArrayMap(
        receiver,
        callback,
        methodCall.loc,
        walkState,
        methodName === "flatMap",
      );
    if (PROMISE_METHODS.has(methodName)) {
      this.callbacks.visitPromiseCallbacks(methodName, argumentValues, methodCall.loc, walkState);
      return createUnknown("async", methodCall.loc);
    }
    if (methodName === "bind" && BOUND_CALLEES.has(receiver.kind))
      return {
        kind: "Bound",
        callee: receiver,
        argumentValues: argumentValues.slice(1),
        loc: methodCall.loc,
      };
    const callSite: CallSite = {
      callee: this.read(methodCall.property),
      calleePlace: methodCall.property,
      argumentValues,
      argumentPlaces,
      loc: methodCall.loc,
    };
    const range =
      receiver.kind === "Global" && receiver.name === "Math"
        ? getClampRange(methodName, argumentValues)
        : null;
    if (range) return this.#createCallResult(callSite, { range });
    return (
      this.#evaluateStringMethod(receiver, methodName, callSite) ??
      this.#evaluateCall(callSite, walkState)
    );
  }

  #evaluateStringMethod(
    receiver: SymbolicValue,
    methodName: string,
    callSite: CallSite,
  ): SymbolicValue | null {
    if (!isStringMethod(methodName)) return null;
    const argumentValues = callSite.argumentValues.flatMap((argument) =>
      argument.kind === "Primitive" ? [argument.value] : [],
    );
    if (argumentValues.length !== callSite.argumentValues.length) return null;
    if (receiver.kind === "Primitive" && typeof receiver.value === "string")
      return {
        kind: "Primitive",
        value: applyStringMethod(methodName, receiver.value, argumentValues),
      };
    if (receiver.kind !== "Binding") return null;
    return this.#createCallResult(callSite, {
      derived: { method: methodName, receiver, argumentValues },
    });
  }

  evaluateInstruction(instruction: Instruction, walkState: WalkState): void {
    const { value } = instruction;
    this.#recordLoadedProperty(instruction);
    this.mutations.recordAliasSources(instruction);
    this.mutations.track(instruction, walkState);
    const instructionResult = this.#evaluateInstructionValue(instruction, walkState);
    if (value.kind === "ArrayExpression" || value.kind === "ObjectExpression")
      this.mutations.recordCreation(instructionResult, walkState);
    this.write(instruction.lvalue, instructionResult);
    this.mutations.trackPossibleMutations(instruction, walkState);
  }

  #evaluateInstructionValue(instruction: Instruction, walkState: WalkState): SymbolicValue {
    const { value } = instruction;
    switch (value.kind) {
      case "Primitive":
        return { kind: "Primitive", value: value.value };
      case "JSXText":
        return { kind: "JSXText", value: value.value };
      case "LoadLocal":
        return this.read(value.place);
      case "LoadContext":
        return this.#evaluateLoadContext(value, walkState);
      case "StoreLocal":
      case "StoreContext":
        return this.#evaluateStoreLocal(value, walkState);
      case "DeclareLocal":
      case "DeclareContext":
        this.write(value.lvalue.place, UNDEFINED_VALUE);
        return UNDEFINED_VALUE;
      case "Destructure":
        this.destructurer.destructure(value);
        return this.read(value.value);
      case "LoadGlobal": {
        const constant =
          value.binding.kind === "ModuleLocal"
            ? this.#loadModuleConstant(value.binding.name)
            : null;
        return constant ?? this.#foldLiteralType(getGlobalValue(value), value.loc);
      }
      case "PropertyLoad":
        return this.#evaluatePropertyLoad(value, walkState);
      case "ComputedLoad":
        return this.#evaluateComputedLoad(value, instruction.id, walkState);
      case "BinaryExpression":
        return foldBinary(value.operator, this.read(value.left), this.read(value.right));
      case "UnaryExpression":
        return foldUnary(value.operator, this.read(value.value));
      case "TypeCastExpression":
        return this.claimRecorder.evaluateTypeCast(value, walkState);
      case "ObjectExpression":
        return this.#evaluateObjectLiteral(value);
      case "ArrayExpression":
        return this.#evaluateArrayLiteral(value);
      case "FunctionExpression":
      case "ObjectMethod":
        return this.#createClosure(value.loweredFunc.func);
      case "CallExpression":
        return this.#evaluateCallExpression(value, walkState);
      case "MethodCall":
        return this.#evaluateMethodCall(value, instruction.id, walkState);
      case "JsxExpression":
        return this.#evaluateJsxElement(value, instruction.id);
      case "JsxFragment":
        return {
          kind: "JsxFragment",
          children: flattenArrayChildren(value.children.map((child) => this.read(child))),
        };
      case "Await":
        return createUnknown("async", value.loc);
      case "NewExpression": {
        const argumentValues = value.args.map((argument) => this.read(getPlaceOrSpread(argument)));
        this.callbacks.passCallbacks(argumentValues, value.loc, walkState);
        const instance = createUnknown(value.kind, value.loc);
        const callbacks = getPassedCallbacks(argumentValues);
        if (callbacks.length > 0) this.#wrappedCallbacks.set(instance, callbacks);
        return instance;
      }
      case "PropertyStore":
        return this.#evaluatePropertyStore(value, walkState);
      case "ComputedStore":
        this.callbacks.passStoredCallback(value, walkState);
        return this.read(value.value);
      case "PrefixUpdateLocal":
      case "PrefixUpdateContext":
        return this.#evaluateUpdateLocal(value, true);
      case "PostfixUpdateLocal":
      case "PostfixUpdateContext":
        return this.#evaluateUpdateLocal(value, false);
      case "TemplateLiteral":
        return this.#evaluateTemplateLiteral(value);
      case "TaggedTemplateExpression":
      case "RegExpLiteral":
      case "MetaProperty":
      case "GetIterator":
      case "IteratorNext":
      case "NextPropertyOf":
      case "PropertyDelete":
      case "ComputedDelete":
      case "StoreGlobal":
      case "UnsupportedNode":
        return createUnknown(value.kind, value.loc);
      case "StartMemoize":
        this.#memoDependencies.set(value.manualMemoId, value.deps);
        return UNDEFINED_VALUE;
      case "FinishMemoize":
        this.#finishMemoize(value);
        this.#bindMutatedMemo(value);
        return UNDEFINED_VALUE;
      case "Debugger":
        return UNDEFINED_VALUE;
      default:
        return assertExhaustive(value, "Unhandled instruction value");
    }
  }

  #evaluatePropertyLoad(
    load: InstructionValueOfKind<"PropertyLoad">,
    walkState: WalkState,
  ): SymbolicValue {
    const object = this.read(load.object);
    const property = String(load.property);
    const [initialRef] = object.kind === "HookResult" ? object.argumentValues : [];
    const isUnsharedRef =
      object.kind === "HookResult" &&
      object.hookKind === "useRef" &&
      property === "current" &&
      initialRef !== undefined &&
      getIdentifierName(load.object) === null;
    if (isUnsharedRef && initialRef.kind === "Function")
      this.#mountClosureIds.add(initialRef.functionId);
    if (isUnsharedRef) return initialRef;
    const loaded = this.#foldLiteralType(
      this.evaluatePropertyLoad(object, property, load.loc),
      load.loc,
    );
    return this.#handlerEffects && isRefCell(object, property)
      ? this.cells.read(getRefCellKey(object.binding), loaded, load.loc, walkState)
      : loaded;
  }

  #evaluatePropertyStore(
    store: InstructionValueOfKind<"PropertyStore">,
    walkState: WalkState,
  ): SymbolicValue {
    this.callbacks.passStoredCallback(store, walkState);
    const object = this.read(store.object);
    const storedValue = this.read(store.value);
    if (this.#handlerEffects && isRefCell(object, String(store.property)))
      this.cells.store(getRefCellKey(object.binding), storedValue, walkState);
    return storedValue;
  }

  #evaluateLoadContext(
    load: InstructionValueOfKind<"LoadContext">,
    walkState: WalkState,
  ): SymbolicValue {
    const loaded = this.read(load.place);
    return this.#handlerEffects
      ? this.cells.read(getContextCellKey(load.place), loaded, load.loc, walkState)
      : loaded;
  }

  #evaluateUpdateLocal(
    update: InstructionValueOfKind<
      "PrefixUpdateLocal" | "PrefixUpdateContext" | "PostfixUpdateLocal" | "PostfixUpdateContext"
    >,
    isPrefix: boolean,
  ): SymbolicValue {
    const previous = this.read(update.value);
    const next = foldBinary(update.operation === "++" ? "+" : "-", previous, ONE_VALUE);
    this.write(update.lvalue, next);
    return isPrefix ? next : previous;
  }

  #evaluateTemplateLiteral(template: InstructionValueOfKind<"TemplateLiteral">): SymbolicValue {
    const parts = template.quasis.flatMap((quasi, index): SymbolicValue[] => {
      const text = quasi.cooked ?? quasi.raw;
      const part = template.subexprs[index];
      return [
        ...(text === "" ? [] : [{ kind: "Primitive", value: text } as const]),
        ...(part ? [this.read(part)] : []),
      ];
    });
    const hasText = parts.some(
      (part) => part.kind === "Primitive" && typeof part.value === "string",
    );
    return (hasText ? parts : [EMPTY_STRING_VALUE, ...parts]).reduce((text, part) =>
      foldBinary("+", text, part),
    );
  }

  #evaluateStoreLocal(
    store: InstructionValueOfKind<"StoreLocal" | "StoreContext">,
    walkState: WalkState,
  ): SymbolicValue {
    const storedValue = this.read(store.value);
    const [initialRef] = storedValue.kind === "HookResult" ? storedValue.argumentValues : [];
    const isConstantRef =
      storedValue.kind === "HookResult" &&
      storedValue.hookKind === "useRef" &&
      initialRef?.kind === "Function" &&
      isRefOnlyRead(this.getCurrentFunction(), store.lvalue.place.identifier.id);
    if (isConstantRef) {
      this.#mountClosureIds.add(initialRef.functionId);
      const constantRef: SymbolicValue = {
        kind: "ObjectExpression",
        properties: [{ key: "current", value: initialRef }],
        spreads: [],
      };
      this.write(store.lvalue.place, constantRef);
      return constantRef;
    }
    const localValue =
      storedValue.kind === "HookResult" && getIdentifierName(store.lvalue.place) !== null
        ? this.destructurer.bindHookResult(store.lvalue.place, storedValue)
        : storedValue;
    this.write(store.lvalue.place, localValue);
    if (store.kind === "StoreContext" && this.#handlerEffects)
      this.cells.store(getContextCellKey(store.lvalue.place), localValue, walkState);
    return localValue;
  }

  #evaluateComputedLoad(
    computedLoad: InstructionValueOfKind<"ComputedLoad">,
    instructionId: InstructionId,
    walkState: WalkState,
  ): SymbolicValue {
    const propertyKey = this.read(computedLoad.property);
    const object = this.read(computedLoad.object);
    const entries = propertyKey.kind === "Primitive" ? null : getLiteralEntries(object);
    if (entries)
      return entries.reduceRight<SymbolicValue>(
        (rest, [key, entry]) => ({
          kind: "Conditional",
          test: foldBinary("===", propertyKey, { kind: "Primitive", value: key }),
          testKind: "truthy",
          consequent: entry,
          alternate: rest,
          branch: this.createBranch(instructionId, computedLoad.loc, "none"),
          guardKeys: walkState.guards.map(getValueKey),
        }),
        UNDEFINED_VALUE,
      );
    if (propertyKey.kind !== "Primitive" || isNullish(propertyKey.value))
      return this.#createDerivedValue(
        [this.read(computedLoad.object), propertyKey],
        "computed-member",
        computedLoad.loc,
      );
    return this.evaluatePropertyLoad(
      this.read(computedLoad.object),
      String(propertyKey.value),
      computedLoad.loc,
    );
  }

  #evaluateObjectLiteral(objectLiteral: InstructionValueOfKind<"ObjectExpression">): SymbolicValue {
    let properties: ObjectExpressionValue["properties"] = [];
    const spreads: SymbolicValue[] = [];
    const define = (defined: ObjectExpressionValue["properties"]): void => {
      const keys = new Set(defined.map((property) => property.key));
      properties = [...properties.filter((property) => !keys.has(property.key)), ...defined];
    };
    for (const property of objectLiteral.properties) {
      if (property.kind === "Spread") {
        const spread = this.read(property.place);
        const fields = this.#getSpreadFields(spread, property.place.loc);
        if (fields) {
          define(fields);
          continue;
        }
        const overridden = createUnknown("spread", property.place.loc);
        properties = properties.map((known) => ({ ...known, value: overridden }));
        spreads.push(spread);
        continue;
      }
      const key = this.#getPropertyKey(property.key);
      if (key === null) return createUnknown("computed-key", objectLiteral.loc);
      define([{ key, value: this.read(property.place) }]);
    }
    return { kind: "ObjectExpression", properties, spreads };
  }

  #getSpreadFields(
    spread: SymbolicValue,
    loc: SourceLocation,
  ): ObjectExpressionValue["properties"] | null {
    if (spread.kind === "ObjectExpression")
      return spread.spreads.length === 0 ? spread.properties : null;
    if (spread.kind !== "Binding") return null;
    const domains = this.#resolver.getPropertyDomains(loc);
    return (
      domains &&
      domains.map(([key, domain]) => ({
        key,
        value: this.bindingTable.readFieldOfDomain(spread.binding, [...spread.path, key], domain),
      }))
    );
  }

  #getPropertyKey(key: ObjectPropertyKey): string | null {
    if (key.kind !== "computed") return String(key.name);
    const keyValue = this.read(key.name);
    return keyValue.kind === "Primitive" &&
      (typeof keyValue.value === "string" || typeof keyValue.value === "number")
      ? String(keyValue.value)
      : null;
  }

  #evaluateArrayLiteral(arrayLiteral: InstructionValueOfKind<"ArrayExpression">): SymbolicValue {
    return {
      kind: "ArrayExpression",
      elements: arrayLiteral.elements.flatMap((element): SymbolicValue[] => {
        if (element.kind === "Identifier") return [this.read(element)];
        return element.kind === "Hole" ? [UNDEFINED_VALUE] : [];
      }),
      spreads: arrayLiteral.elements.flatMap((element) =>
        element.kind === "Spread" ? [this.read(element.place)] : [],
      ),
    };
  }

  #evaluateCallExpression(
    call: InstructionValueOfKind<"CallExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const argumentPlaces = call.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.read(place));
    const mapped = this.iteration.evaluateLoadedArrayMap(call, argumentValues, walkState);
    if (mapped) return mapped;
    return this.#evaluateCall(
      {
        callee: this.read(call.callee),
        calleePlace: call.callee,
        argumentValues,
        argumentPlaces,
        loc: call.loc,
      },
      walkState,
    );
  }

  getPropertyName(place: Place): string | null {
    return this.getCompilationTables().propertyNames.get(place.identifier.id) ?? null;
  }

  getPropertyObject(place: Place): Place | undefined {
    return this.getCompilationTables().propertyObjects.get(place.identifier.id);
  }

  #recordLoadedProperty(instruction: Instruction): void {
    const { value } = instruction;
    const tables = this.getCompilationTables();
    if (value.kind === "PropertyLoad") {
      tables.propertyNames.set(instruction.lvalue.identifier.id, String(value.property));
      tables.propertyObjects.set(instruction.lvalue.identifier.id, value.object);
      return;
    }
    const [from, to] =
      value.kind === "StoreLocal"
        ? [value.value, value.lvalue.place]
        : value.kind === "LoadLocal"
          ? [value.place, instruction.lvalue]
          : [null, null];
    if (!from || !to) return;
    const name = tables.propertyNames.get(from.identifier.id);
    const object = tables.propertyObjects.get(from.identifier.id);
    if (name !== undefined) tables.propertyNames.set(to.identifier.id, name);
    if (object) tables.propertyObjects.set(to.identifier.id, object);
  }

  #readJsxProps(element: InstructionValueOfKind<"JsxExpression">): Array<JsxProp | JsxSpreadProp> {
    return element.props.map((attribute): JsxProp | JsxSpreadProp =>
      attribute.kind === "JsxAttribute"
        ? {
            kind: "JsxAttribute",
            name: attribute.name,
            value: this.read(attribute.place),
            handlerId: null,
            loc: attribute.place.loc,
            file: this.#resolver.fileName,
          }
        : {
            kind: "JsxSpreadAttribute",
            value: this.read(attribute.argument),
            handlerId: null,
            loc: attribute.argument.loc,
            file: this.#resolver.fileName,
          },
    );
  }

  #recordProvidedContext(
    element: InstructionValueOfKind<"JsxExpression">,
    props: Array<JsxProp | JsxSpreadProp>,
  ): void {
    if (element.tag.kind === "BuiltinTag") return;
    const providedValue = props.find(
      (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "value",
    );
    const contextKey = providedValue ? this.#resolver.getContextKey(element.tag.loc) : null;
    if (providedValue && contextKey)
      this.providedContexts.push({ contextKey, value: providedValue.value });
  }

  #evaluateJsxElement(
    element: InstructionValueOfKind<"JsxExpression">,
    instructionId: InstructionId,
  ): SymbolicValue {
    const props = this.#readJsxProps(element);
    this.#recordProvidedContext(element, props);
    const isBuiltinTag = element.tag.kind === "BuiltinTag";
    const reactExport = isBuiltinTag ? null : this.#resolver.getReactExportName(element.tag.loc);
    const jsxValue = buildJsx(
      this.#getJsxTag(element.tag),
      {
        declaration: isBuiltinTag ? null : this.#resolver.getDeclarationKey(element.tag.loc),
        isContext: !isBuiltinTag && this.#resolver.isContext(element.tag.loc),
        reactExport,
        props,
        children: flattenArrayChildren((element.children ?? []).map((child) => this.read(child))),
        loc: element.loc,
        file: this.#resolver.fileName,
      },
      this.renderedComponents,
    );
    return reactExport === "Suspense" && jsxValue.kind === "JsxExpression"
      ? this.#buildSuspense(jsxValue, instructionId)
      : jsxValue;
  }

  createBranch(terminalId: InstructionId, loc: SourceLocation, probe: Branch["probe"]): Branch {
    return { terminalId, probe, loc, file: this.#resolver.fileName };
  }

  #evaluateFunction(
    hirFunction: HIRFunction,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
    functionId: number | null = null,
  ): SymbolicValue {
    const previousFunction = this.#currentFunction;
    const previousResolver = this.#resolver;
    const previousFunctionScope = this.walker.functionScope;
    this.walker.functionScope = createFunctionScope();
    this.#currentFunction = hirFunction;
    this.#resolver = this.#functions.getResolver(hirFunction) ?? previousResolver;
    const restoreLiveValues = this.#applyCapturedValues(functionId);
    const closureIds: number[] = [];
    this.#frameClosureIds.push(closureIds);
    try {
      hirFunction.params.forEach((parameter, parameterIndex) => {
        const parameterPlace = getPlaceOrSpread(parameter);
        this.write(
          parameterPlace,
          parameter.kind === "Spread"
            ? {
                kind: "ArrayExpression",
                elements: argumentValues.slice(parameterIndex),
                spreads: [createUnknown("rest", parameterPlace.loc)],
              }
            : (argumentValues[parameterIndex] ?? UNDEFINED_VALUE),
        );
      });
      return this.walker.getOutcomeValue(
        this.walker.walk(hirFunction.body.entry, NO_STOPS, null, walkState, "unresolved"),
        hirFunction.loc,
        walkState.guards,
      );
    } finally {
      this.#frameClosureIds.pop();
      const outerIdentifierIds = new Set(hirFunction.context.map((place) => place.identifier.id));
      for (const closureId of closureIds)
        this.#functions.setCapturedValues(
          closureId,
          this.#functions
            .getCapturedValues(closureId)
            .map(([place, value]): CapturedValue => [
              place,
              outerIdentifierIds.has(place.identifier.id) ? value : this.read(place),
            ]),
        );
      restoreLiveValues();
      this.#currentFunction = previousFunction;
      this.#resolver = previousResolver;
      this.walker.functionScope = previousFunctionScope;
    }
  }

  #runRenderedHandlers(renderedValue: SymbolicValue, visitedFunctionIds: Set<number>): void {
    forEachJsxElement(renderedValue, (element) => {
      for (const prop of element.props)
        if (prop.kind === "JsxAttribute" && isHandlerProp(element.tag, prop))
          this.#runCallback(prop.value, [EVENT_ARGUMENT], visitedFunctionIds);
    });
  }

  #runCallback(
    callback: SymbolicValue,
    argumentValues: SymbolicValue[],
    visitedFunctionIds: Set<number>,
    walkState: WalkState = ROOT_WALK_STATE,
  ): SymbolicValue | null {
    if (callback.kind === "Conditional") {
      const test = getTestExpression(callback);
      const consequentWalkState = { ...walkState, guards: [...walkState.guards, test] };
      const alternateWalkState = { ...walkState, guards: [...walkState.guards, negate(test)] };
      this.#runCallback(
        callback.consequent,
        argumentValues,
        visitedFunctionIds,
        consequentWalkState,
      );
      this.#runCallback(callback.alternate, argumentValues, visitedFunctionIds, alternateWalkState);
      return null;
    }
    if (callback.kind === "Bound")
      return this.#runCallback(
        callback.callee,
        [...callback.argumentValues, ...argumentValues],
        visitedFunctionIds,
        walkState,
      );
    if (callback.kind === "Setter")
      this.#handlerEffects?.recordSetterCall(
        callback.binding,
        argumentValues[0] ?? EVENT_ARGUMENT,
        walkState,
      );
    if (callback.kind === "Dispatch")
      this.#applyDispatch(callback, argumentValues[0], callback.binding.loc, walkState);
    if (callback.kind === "Binding") this.#callBinding(callback, argumentValues, walkState);
    if (callback.kind !== "Function" || visitedFunctionIds.has(callback.functionId)) return null;
    visitedFunctionIds.add(callback.functionId);
    const hirFunction = this.#functions.get(callback.functionId);
    if (!hirFunction) return null;
    const externalArguments = hirFunction.params.map(
      (_parameter, index) =>
        argumentValues[index] ?? createUnknown("callback-argument", callback.loc),
    );
    const result = this.#evaluateCallee(
      hirFunction,
      externalArguments,
      walkState,
      callback.functionId,
    );
    this.#runRenderedHandlers(result, visitedFunctionIds);
    return result;
  }
}
