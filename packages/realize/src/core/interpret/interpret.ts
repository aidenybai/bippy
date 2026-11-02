import type {
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  ObjectPropertyKey,
  Place,
  SourceLocation,
} from "../../react-compiler/HIR/HIR";
import { addsCallResult } from "./adds-call-result";
import {
  GeneratedSource,
  InstructionKind,
  SETTER_KEY_PREFIX,
  getHookKind,
} from "../../react-compiler/HIR/HIR";
import type { HookKind } from "../../react-compiler/HIR/ObjectShape";
import { assertExhaustive } from "../../react-compiler/Utils/utils";
import type { SourceFileResolver } from "../type-checker/source-file-resolver";
import { ArrayIteration, ITERATION_METHODS, RENDERED_ITERATION_METHODS } from "./array-iteration";
import { CallbackPasser } from "./callback-passer";
import { AssertionRecorder } from "./assertion-recorder";
import { ControlFlowWalker, createFunctionScope } from "./control-flow-walker";
import { Destructurer } from "./destructurer";
import { MemoStaleness } from "./memo-staleness";
import { MutationTracker } from "./mutation-tracker";
import type { BranchOperator } from "./control-flow-walker";
import { ROOT_PATH_STATE, getAsyncPathState } from "./path-state";
import type { PathState } from "./path-state";
import type {
  ArrayExpressionValue,
  Binding,
  BranchEvaluation,
  PrimitiveValue,
  BindingKind,
  BindingPlace,
  BindingValue,
  CollectionValue,
  BranchSite,
  TestKind,
  ContextSetterFields,
  DispatchValue,
  Domain,
  FunctionValue,
  HookResultValue,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  ObjectExpressionValue,
  ProvidedContext,
  Sample,
  SetterValue,
  StoreModel,
  SymbolicValue,
  WarningKind,
} from "../types";
import { formatPlace, formatSymbolicValue } from "../values/format";
import { forEachJsxElement } from "../render/for-each-jsx-element";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { EVENT_ARGUMENT } from "../handlers/handler-predicates";
import { isHandlerProp } from "../handlers/dom-events";
import { PlaceMap } from "../values/place-map";
import { ALL_HELD_PROPS } from "./get-prop-holds";
import type { HeldProps } from "./get-prop-holds";
import { getBindingPlace } from "../values/get-binding-place";
import { getLiteralArrayCall, getMathCall, getPureCallDomain } from "./derived-calls";
import type { PureCall } from "./derived-calls";
import { isPureFunction } from "../interpret/pure-functions";
import { createDeclarationKey } from "../project/declaration-key";
import { getLocationKey } from "../shared/get-location-key";
import { getPropertyKeyForms } from "./get-property-key-forms";
import { getDomainPrimitive } from "../type-checker/domains";
import { isRefOnlyRead } from "./is-ref-only-read";
import { applyStringMethod, isStringMethod } from "../interpret/string-methods";
import {
  applyCollectionMethod,
  getCollectionSize,
  isCollectionRead,
} from "../interpret/literal-receivers";
import { getValueKey } from "../values/get-value-key";
import { getValuePlace } from "../values/get-value-place";
import { getLiteralRead } from "./literal-reads";
import { isStatelessRegExp } from "./is-stateless-regexp";
import { isExternalSource } from "../handlers/is-external-source";
import { isNullish } from "../values/is-nullish";
import { isPlacePrefix } from "../values/is-place-prefix";
import { getTestExpression } from "../values/get-test-expression";
import { coerceBooleanCall } from "./coerce-boolean-call";
import { negate } from "../values/negate";
import {
  EMPTY_STRING_VALUE,
  ONE_VALUE,
  MEMO_CACHE_VALUE,
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  foldUnary,
  getContainedValues,
  getPassedCallbacks,
  isStartTransition,
  isMemoCacheCall,
  CALLABLE_KINDS,
  isCallableValue,
  getOriginValues,
  hasUnknownPart,
} from "../values/symbolic-values";
import { BindingTable } from "./binding-table";
import type { BindingOptions } from "./binding-table";
import { buildJsx } from "./build-jsx";
import { Diagnostics } from "./diagnostics";
import { EffectCollector } from "./effect-collector";
import type { CollectedEffects } from "./effect-collector";
import { ExternalSources, getStoreFieldValue } from "./external-sources";
import { StoreReads } from "./store-reads";
import { Cells } from "./cells";
import { FunctionRegistry } from "../compile/function-registry";
import type {
  ImportUse,
  ModuleConstantLoader,
  ModuleDeclaration,
  ModuleVariableLoader,
} from "../compile/module-values";
import type { CapturedValue, ModuleFunctionLoader } from "../compile/function-registry";
import { NO_STOPS } from "./control-flow";
import { getIdentifierName } from "./get-identifier-name";
import { getPlaceOrSpread } from "./get-place-or-spread";
import {
  getStoredContextPlaces,
  getReassignedIds,
  getWrittenContextPlaces,
} from "./get-written-context-places";
import { getHookTraits } from "./hook-traits";
import { memoizeByIdentity } from "../shared/memoize-by-identity";

const LOOP_KINDS = new Set(["for", "for-of", "for-in", "while", "do-while"]);

const hasLoop = memoizeByIdentity((hirFunction: HIRFunction): boolean =>
  [...hirFunction.body.blocks.values()].some((block) => LOOP_KINDS.has(block.terminal.kind)),
);

const flattenArrayChildren = (children: SymbolicValue[]): SymbolicValue[] =>
  children.flatMap((child) =>
    child.kind === "ArrayExpression"
      ? flattenArrayChildren([...child.elements, ...child.spreads])
      : [child],
  );

const isNullishValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && isNullish(value.value);

const isSameValueZero = (left: PrimitiveValue, right: PrimitiveValue): boolean =>
  left === right || (Number.isNaN(left) && Number.isNaN(right));

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
  loc: SourceLocation;
}

export interface CallSite {
  callee: SymbolicValue;
  calleePlace: Place;
  receiver?: SymbolicValue;
  thisValue?: SymbolicValue;
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
  frozenSources: Map<IdentifierId, Place>;
  itemSources: Map<IdentifierId, Place>;
}

type CallTarget =
  | { kind: "Portal"; children: SymbolicValue }
  | { kind: "ProjectHook"; projectHook: ProjectHook }
  | { kind: "Store"; storeKey: string; storeModel: StoreModel }
  | { kind: "Hook"; hookKind: HookKind }
  | { kind: "ModuleFunction"; hirFunction: HIRFunction }
  | { kind: "Transition" }
  | { kind: "Value" };

export interface ProjectHook {
  hirFunction: HIRFunction;
  resolver: SourceFileResolver;
  loadModuleFunction: ModuleFunctionLoader;
}

interface ProjectHookLoader {
  (declarationKey: string): ProjectHook | null;
}

export interface ProjectModuleDeclaration extends ModuleDeclaration {
  name: string;
  resolver: SourceFileResolver;
}

export interface ProjectLoaders {
  loadProjectHook: ProjectHookLoader;
  loadProjectFunction: ProjectHookLoader;
  loadProjectComponent: (declarationKey: string) => HIRFunction | null;
  loadHeldProps: (declarationKey: string) => HeldProps;
  loadHeldContexts: () => ReadonlySet<string>;
  loadMutatedParameters: (declarationKey: string) => Map<number, boolean>;
  loadModuleDeclaration: (declarationKey: string) => ProjectModuleDeclaration | null;
  loadImportUse: (declarationKey: string) => ImportUse;
  isReadOnlyDeclaration: (declarationKey: string) => boolean;
}

const BOUND_RECEIVERS = new Set<string>([...CALLABLE_KINDS, "Binding", "Conditional"]);

const MAX_INLINE_DEPTH = 4;
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
  base: SymbolicValue,
  properties: ObjectExpressionValue["properties"],
): ObjectExpressionValue => ({
  kind: "ObjectExpression",
  properties,
  spreads: [base],
});

const INVOKABLE_KINDS = new Set<SymbolicValue["kind"]>([
  "Function",
  "Setter",
  "Dispatch",
  "Conditional",
]);

const isBuiltinMember = (property: string): boolean =>
  property in Array.prototype || property in Object.prototype;

const hasLiteralArrayLeaf = (value: SymbolicValue): boolean =>
  value.kind === "Conditional"
    ? hasLiteralArrayLeaf(value.consequent) || hasLiteralArrayLeaf(value.alternate)
    : value.kind === "ArrayExpression";

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

const BINDING_OBJECT_READS = new Set(["keys", "values", "entries"]);

const getLiteralPathValue = (value: SymbolicValue | null, path: string[]): SymbolicValue | null => {
  const [key, ...rest] = path;
  if (key === undefined) return value;
  const property =
    value?.kind === "ObjectExpression" && value.spreads.length === 0
      ? value.properties.find((candidate) => candidate.key === key)
      : undefined;
  return property ? getLiteralPathValue(property.value, rest) : null;
};

const getLiteralEntries = (
  value: SymbolicValue,
): Array<[string | number, SymbolicValue]> | null => {
  if (value.kind === "ArrayExpression" && value.spreads.length === 0)
    return value.elements.map((element, index) => [index, element]);
  if (value.kind === "ObjectExpression" && value.spreads.length === 0)
    return value.properties.map((property) => [property.key, property.value]);
  return null;
};

const getLiteralEntryValue = (
  source: SymbolicValue | null,
  key: PrimitiveValue | undefined,
): SymbolicValue | null => {
  if (source?.kind !== "ArrayExpression" || source.spreads.length > 0) return null;
  for (const entry of source.elements) {
    if (entry.kind !== "ArrayExpression" || entry.spreads.length > 0) return null;
    const [entryKey, entryValue] = entry.elements;
    if (entryKey?.kind !== "Primitive") return null;
    if (isSameValueZero(entryKey.value, key)) return entryValue ?? UNDEFINED_VALUE;
  }
  return UNDEFINED_VALUE;
};

const getCalleeName = (callSite: CallSite, target: CallTarget): string | null =>
  callSite.callee.kind === "Global"
    ? callSite.callee.name
    : target.kind === "ModuleFunction"
      ? target.hirFunction.id
      : null;

const getRefCellKey = (binding: Binding): string => `ref:${binding.id}`;

const getContextCellKey = (place: Place): string => `context:${place.identifier.id}`;

const MAX_CALL_NAME_LENGTH = 200;

const CONSTANT_DECLARATION_KINDS = new Set([
  InstructionKind.Const,
  InstructionKind.HoistedConst,
  InstructionKind.Function,
  InstructionKind.HoistedFunction,
]);

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
  if (!isArrayIndex)
    return createUnknown("member", loc, { kind: "Member", object: array, property });
  return array.elements[index] ?? UNDEFINED_VALUE;
};

const JSX_RUNTIME_MODULES = new Set(["react/jsx-runtime", "react/jsx-dev-runtime"]);

const getGlobalValue = (loadGlobal: InstructionValueOfKind<"LoadGlobal">): SymbolicValue => {
  if (loadGlobal.binding.kind === "Global" && loadGlobal.binding.name === "undefined")
    return UNDEFINED_VALUE;
  return {
    kind: "Global",
    name: loadGlobal.binding.name,
    module: "module" in loadGlobal.binding ? loadGlobal.binding.module : null,
  };
};

const getReturnedFunctions = (value: SymbolicValue): SymbolicValue[] => {
  if (value.kind === "Conditional")
    return [...getReturnedFunctions(value.consequent), ...getReturnedFunctions(value.alternate)];
  return value.kind === "Function" ? [value] : [];
};

const COLLECTION_CONSTRUCTORS = new Map<string, CollectionValue["collection"]>([
  ["Set", "Set"],
  ["Map", "Map"],
]);

const CHAINED_COLLECTION_WRITES = new Set(["add", "set"]);

const STORED_ITEM_READS = new Set(["get", "at", "find", "findLast"]);

const nameUnknownArgument = (argument: SymbolicValue, name: string | null): SymbolicValue =>
  argument.kind === "Unknown" && !argument.origin && name !== null
    ? { ...argument, origin: { kind: "Name", name } }
    : argument;

const getSetterAccessor = (object: SymbolicValue, property: string): FunctionValue | null => {
  if (object.kind === "Conditional")
    return (
      getSetterAccessor(object.consequent, property) ??
      getSetterAccessor(object.alternate, property)
    );
  const literal =
    object.kind === "Binding" && object.path.length === 0 ? object.binding.initial : object;
  const setter =
    literal?.kind === "ObjectExpression"
      ? literal.properties.find((candidate) => candidate.key === `${SETTER_KEY_PREFIX}${property}`)
          ?.value
      : undefined;
  return setter?.kind === "Function" ? setter : null;
};

const getStoredLabel = (value: BindingValue): string =>
  `${formatPlace(value.binding, value.path)}@${value.binding.id}`;

const ARRAY_INDEX_PATTERN = /^\d+$/;

const REF_CONTAINER_WRITES = new Set(["push", "unshift", "add", "set"]);

const isRefContents = (value: BindingValue): boolean =>
  value.binding.kind === "ref" && value.path[0] === "current";

const getCollectionEntries = (
  receiver: SymbolicValue,
): Map<PrimitiveValue, SymbolicValue> | null => {
  if (receiver.kind !== "Collection" || receiver.writes.length > 0) return null;
  if (receiver.source?.kind !== "ArrayExpression" || receiver.source.spreads.length > 0)
    return null;
  const entries = new Map<PrimitiveValue, SymbolicValue>();
  for (const element of receiver.source.elements) {
    const [entryKey, entryValue] =
      receiver.collection === "Map" && element.kind === "ArrayExpression"
        ? element.elements
        : [element, element];
    const isKey =
      entryKey?.kind === "Primitive" &&
      !(typeof entryKey.value === "number" && Number.isNaN(entryKey.value));
    if (!isKey || entryKey.kind !== "Primitive") return null;
    entries.set(entryKey.value, entryValue ?? UNDEFINED_VALUE);
  }
  return entries;
};

const getSourceItems = (source: SymbolicValue | null, loc: SourceLocation): SymbolicValue[] => {
  if (source === null) return [];
  if (source.kind !== "ArrayExpression") return [createUnknown("item", loc)];
  return [...source.elements, ...source.spreads.map(() => createUnknown("item", loc))];
};

const getSetItems = (receiver: SymbolicValue, loc: SourceLocation): SymbolicValue[] | null => {
  if (receiver.kind !== "Collection" || receiver.collection !== "Set") return null;
  const addedItems = receiver.writes
    .filter((write) => write.method === "add")
    .map((write) => write.argumentValues[0] ?? createUnknown("item", loc));
  return [...getSourceItems(receiver.source, loc), ...addedItems];
};

const getConcatenatedParts = (value: SymbolicValue): SymbolicValue[] | null => {
  if (value.kind === "Primitive") return typeof value.value === "string" ? [value] : null;
  if (value.kind !== "BinaryExpression" || value.operator !== "+") return null;
  const leftParts = getConcatenatedParts(value.left);
  return leftParts && [...leftParts, value.right];
};

export class Interpreter {
  #resolver: SourceFileResolver;
  readonly #projectLoaders: ProjectLoaders;
  readonly #loadModuleConstant: ModuleConstantLoader;
  readonly #loadModuleVariable: ModuleVariableLoader;
  readonly #constantContextIds = new Set<IdentifierId>();
  readonly #componentResolver: SourceFileResolver;
  #componentCallLoc: SourceLocation | null = null;
  readonly #itemSources = new Map<number, PlaceMap<true>>();
  readonly #tablesByEnvironment = new WeakMap<object, CompilationTables>();
  readonly functions = new FunctionRegistry();
  readonly walker = new ControlFlowWalker(this);
  readonly mutations = new MutationTracker(this);
  readonly destructurer = new Destructurer(this);
  readonly assertionRecorder = new AssertionRecorder(this);
  readonly callbacks = new CallbackPasser(this);
  cells = new Cells();
  readonly memoStaleness = new MemoStaleness(this);
  readonly iteration = new ArrayIteration(this);
  readonly bindingTable = new BindingTable();
  readonly branchEvaluations: BranchEvaluation[] = [];
  readonly externalSources: ExternalSources;
  readonly storeReads = new StoreReads(this);
  readonly diagnostics = new Diagnostics();
  readonly effectCalls: EffectCall[] = [];
  refEventDispatcher: ((refId: number, methodName: string) => SymbolicValue[]) | null = null;
  readonly #dispatchingRefEvents = new Set<string>();
  readonly #renderPhaseEffects = new EffectCollector((kind, message, loc) =>
    this.warn(kind, message, loc),
  );
  readonly renderedComponents = new Set<string>();
  readonly #renderMutatedIds = new Set<number>();
  readonly #wrappedCallbacks = new WeakMap<SymbolicValue, SymbolicValue[]>();
  readonly #importDeclarationKeys = new WeakMap<SymbolicValue, string>();
  readonly #wrappedCallbacksByBinding = new Map<number, SymbolicValue[]>();
  readonly #sourcesByBinding = new Map<number, SymbolicValue[]>();
  readonly #unknownSources = new WeakMap<SymbolicValue, SymbolicValue[]>();
  readonly #unknownSourceKeys = new WeakMap<SymbolicValue, Set<string>>();
  #wholePropsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  #handlerEffects: EffectCollector | null = null;
  #currentFunction: HIRFunction | null = null;
  readonly #inlinedFunctions = new Set<HIRFunction>();
  readonly #thisValues = new Map<HIRFunction, SymbolicValue>();
  readonly #mountClosureIds = new Set<number>();
  readonly #storedFunctions = new PlaceMap<SymbolicValue[]>();
  #storedFunctionCount = 0;
  readonly #frameClosureIds: number[][] = [];
  readonly #bindingScopes: string[] = [];

  constructor(
    resolver: SourceFileResolver,
    loadModuleFunction: ModuleFunctionLoader,
    loadModuleConstant: ModuleConstantLoader,
    loadModuleVariable: ModuleVariableLoader,
    projectLoaders: ProjectLoaders,
    contextSetterFields: ContextSetterFields,
    modelsByStore: Map<string, StoreModel>,
  ) {
    this.#resolver = resolver;
    this.#loadModuleConstant = loadModuleConstant;
    this.#loadModuleVariable = loadModuleVariable;
    this.#componentResolver = resolver;
    this.functions.addModule(resolver, loadModuleFunction);
    this.#projectLoaders = projectLoaders;
    this.externalSources = new ExternalSources(contextSetterFields, modelsByStore);
  }

  get resolver(): SourceFileResolver {
    return this.#resolver;
  }

  get handlerEffects(): EffectCollector | null {
    return this.#handlerEffects;
  }

  get wholePropsSample(): Sample | null {
    return this.#wholePropsSample ?? this.destructurer.restPropsSample;
  }

  evaluateComponent(hirFunction: HIRFunction): SymbolicValue {
    this.walker.blockVisits = 0;
    return this.#evaluateFunction(hirFunction, [{ kind: "Props" }], ROOT_PATH_STATE);
  }

  markRenderMutation(binding: Binding): void {
    this.#renderMutatedIds.add(binding.id);
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
      const rootPathState = { ...ROOT_PATH_STATE, renderGuards, guards };
      const results: SymbolicValue[] = [];
      for (const [index, handlerCallback] of callbacks.entries()) {
        const pathState =
          callback.kind === "ObjectExpression" && callbacks.length > 1
            ? {
                ...rootPathState,
                guards: [...guards, createUnknown(`called:${index}`, GeneratedSource)],
              }
            : rootPathState;
        const returned = runsCleanup
          ? this.#getReturnedValue(handlerCallback, argumentValues, pathState)
          : null;
        const cleanups = returned ? getReturnedFunctions(returned) : [];
        const updateCountBeforeCleanup = handlerEffects.updateCount;
        const cleanupPathState =
          returned?.kind === "Function"
            ? pathState
            : {
                ...pathState,
                guards: [...pathState.guards, createUnknown("previous-render", GeneratedSource)],
              };
        for (const cleanup of cleanups) this.#runCallback(cleanup, [], new Set(), cleanupPathState);
        handlerEffects.forgetRenderValues(updateCountBeforeCleanup);
        if (cleanups.length > 0) this.cells = new Cells();
        const result = this.#runCallback(handlerCallback, argumentValues, new Set(), pathState);
        if (result) results.push(result);
      }
      this.forgetHandlerWrites(callback);
      if (handlerEffects.callsOutside && !handlerEffects.mutatesModule)
        this.storeReads.recordExternalStoreChanges(handlerEffects);
      if (callback.kind === "Unknown" || callback.kind === "Global")
        for (const binding of this.bindingTable.bindings)
          if (isExternalSource(binding))
            this.storeReads.recordExternalUpdate(
              handlerEffects,
              createBindingValue(binding),
              ROOT_PATH_STATE,
            );
      return { ...handlerEffects.finish(), returned: results };
    } finally {
      this.#handlerEffects = previousEffects;
      this.walker.blockVisits = previousBlockVisits;
    }
  }

  #getReturnedValue(
    callback: SymbolicValue,
    argumentValues: SymbolicValue[],
    pathState: PathState,
  ): SymbolicValue | null {
    return this.#withoutEffects(callback, () =>
      this.#runCallback(callback, argumentValues, new Set(), pathState),
    );
  }

  #withoutEffects<Result>(callback: SymbolicValue | undefined, run: () => Result): Result {
    const handlerEffects = this.#handlerEffects;
    const cells = this.cells;
    const hirFunction =
      callback?.kind === "Function" ? this.functions.get(callback.functionId) : undefined;
    const values = hirFunction ? this.getCompilationTables(hirFunction).values : null;
    const savedValues = new Map(values);
    this.#handlerEffects = new EffectCollector(() => {});
    this.cells = new Cells();
    try {
      return run();
    } finally {
      this.#handlerEffects = handlerEffects;
      this.cells = cells;
      for (const [id, value] of savedValues) values?.set(id, value);
    }
  }

  #getUpdateCollector(): EffectCollector {
    return this.#handlerEffects ?? this.#renderPhaseEffects;
  }

  #registerFunction(hirFunction: HIRFunction, isSnapshot = false): FunctionValue {
    return this.functions.register(hirFunction, this.#resolver, isSnapshot);
  }

  #createClosure(hirFunction: HIRFunction): FunctionValue {
    const isInlined = this.#inlinedFunctions.size > 0;
    const closure = this.#registerFunction(hirFunction, isInlined);
    if (!isInlined) return closure;
    this.functions.setCapturedValues(
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
      : this.functions.getCapturedValues(functionId);
    const hirFunction = functionId === null ? undefined : this.functions.get(functionId);
    const writtenPlaces =
      this.#handlerEffects && hirFunction && !isCreatingFrameActive
        ? getStoredContextPlaces(hirFunction)
        : [];
    const liveValues = [...capturedValues.map(([place]) => place), ...writtenPlaces].map(
      (place): CapturedValue => [place, this.read(place)],
    );
    for (const [place, value] of capturedValues) this.write(place, value);
    for (const place of writtenPlaces) this.write(place, createUnknown("handler-write", place.loc));
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
    const compilationTables = this.#tablesByEnvironment.get(hirFunction.env) ?? {
      values: new Map(),
      propertyNames: new Map(),
      propertyObjects: new Map(),
      branchOperators: new Map(),
      aliasSources: new Map(),
      elementSources: new Map(),
      frozenSources: new Map(),
      itemSources: new Map(),
    };
    this.#tablesByEnvironment.set(hirFunction.env, compilationTables);
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

  #getConcatenationLength(text: SymbolicValue, loc: SourceLocation): SymbolicValue {
    const parts = getConcatenatedParts(text);
    if (!parts) return createUnknown("member", loc);
    const inputPlaces = new PlaceMap<true>();
    this.collectInputPlaces(text, inputPlaces);
    return createBindingValue(
      this.createBinding(`(${formatSymbolicValue(text)}).length`, "call", loc, {
        inputPlaces: inputPlaces.places(),
        isDerived: true,
      }),
    );
  }

  evaluatePropertyLoad(
    object: SymbolicValue,
    property: string,
    loc: SourceLocation,
  ): SymbolicValue {
    switch (object.kind) {
      case "Binding":
        return this.#renderMutatedIds.has(object.binding.id) && !this.#handlerEffects
          ? createUnknown("mutated", loc)
          : this.readField(object.binding, [...object.path, property], loc);
      case "Props":
        return createBindingValue(this.getPropBinding(property, property, loc));
      case "ObjectExpression":
        return (
          object.properties.findLast((candidate) => candidate.key === property)?.value ??
          this.#loadSpreadField(object.spreads, property, loc)
        );
      case "ArrayExpression": {
        if (object.spreads.length === 0) return getArrayLiteralMember(object, property, loc);
        const opaque = createUnknown("member", loc, { kind: "Member", object, property });
        const element = ARRAY_INDEX_PATTERN.test(property)
          ? object.elements[Number(property)]
          : undefined;
        return element
          ? {
              kind: "Conditional",
              test: createUnknown("spread-index", loc),
              testKind: "truthy",
              consequent: element,
              alternate: opaque,
              branch: this.createBranchSite(loc),
            }
          : opaque;
      }
      case "Primitive":
        return property === "length" && typeof object.value === "string"
          ? { kind: "Primitive", value: object.value.length }
          : createUnknown("member", loc, { kind: "Member", object, property });
      case "Global":
        return { kind: "Global", name: `${object.name}.${property}`, module: object.module };
      case "Collection": {
        const size = property === "size" ? getCollectionSize(object) : null;
        return size === null
          ? createUnknown("member", loc, { kind: "Member", object, property })
          : { kind: "Primitive", value: size };
      }
      case "BinaryExpression":
        return property === "length"
          ? this.#getConcatenationLength(object, loc)
          : createUnknown("member", loc, { kind: "Member", object, property });
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
        return createUnknown("member", loc, { kind: "Member", object, property });
    }
  }

  #getJsxTag(tag: InstructionValueOfKind<"JsxExpression">["tag"]): SymbolicValue {
    if (tag.kind === "BuiltinTag") return { kind: "Primitive", value: tag.name };
    return this.read(tag);
  }

  #buildSuspense(element: JsxExpressionValue): SymbolicValue {
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
      branch: this.createBranchSite(element.loc),
    };
  }

  callFunction(
    callee: FunctionValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
    thisValue?: SymbolicValue,
  ): SymbolicValue {
    const hirFunction = this.functions.get(callee.functionId);
    if (!hirFunction) return createUnknown("call", loc);
    if (
      this.#inlinedFunctions.size >= MAX_INLINE_DEPTH ||
      this.#inlinedFunctions.has(hirFunction)
    ) {
      this.#recordReachableSetters(callee, loc, pathState, new Set());
      return createUnknown("call", loc);
    }
    this.#inlinedFunctions.add(hirFunction);
    const previousCallLoc = this.#componentCallLoc;
    if (this.#resolver === this.#componentResolver) this.#componentCallLoc = loc;
    try {
      return this.#evaluateCallee(
        hirFunction,
        argumentValues,
        pathState,
        callee.functionId,
        thisValue,
      );
    } finally {
      this.#inlinedFunctions.delete(hirFunction);
      this.#componentCallLoc = previousCallLoc;
    }
  }

  #recordReachableSetters(
    callee: FunctionValue,
    loc: SourceLocation,
    pathState: PathState,
    visited: Set<number>,
  ): void {
    const collector = this.#handlerEffects;
    if (!collector || visited.has(callee.functionId)) return;
    visited.add(callee.functionId);
    for (const place of this.functions.get(callee.functionId)?.context ?? []) {
      const value = this.read(place);
      if (value.kind === "Setter" || value.kind === "Dispatch")
        collector.recordSetterCall(value.binding, createUnknown("call", loc), pathState);
      if (value.kind === "Function") this.#recordReachableSetters(value, loc, pathState, visited);
    }
  }

  getItemSources(item: Binding): PlaceMap<true> | undefined {
    return this.#itemSources.get(item.id);
  }

  addItemSource(item: Binding, array: SymbolicValue): void {
    const sources = this.#itemSources.get(item.id) ?? new PlaceMap<true>();
    this.collectInputPlaces(array, sources);
    this.#itemSources.set(item.id, sources);
  }

  addMountClosure(closure: FunctionValue): void {
    this.#mountClosureIds.add(closure.functionId);
  }

  get storedFunctionCount(): number {
    return this.#storedFunctionCount;
  }

  addStoredFunctions(place: BindingValue, value: SymbolicValue, isMountClosure = true): void {
    if (value.kind === "Conditional") {
      this.addStoredFunctions(place, value.consequent, isMountClosure);
      this.addStoredFunctions(place, value.alternate, isMountClosure);
      return;
    }
    if (value.kind !== "ObjectExpression") {
      this.#addStoredValues(place, value, isMountClosure);
      return;
    }
    for (const property of value.properties)
      this.addStoredFunctions(
        { ...place, path: [...place.path, property.key] },
        property.value,
        isMountClosure,
      );
    for (const spread of value.spreads) this.#addStoredValues(place, spread, isMountClosure);
  }

  #addStoredValues(place: BindingValue, value: SymbolicValue, isMountClosure: boolean): void {
    const storedPlace = getValuePlace(place);
    const current = this.#storedFunctions.get(storedPlace) ?? [];
    const known = new Set(current.map(getValueKey));
    const added = getPassedCallbacks([value]).filter(
      (callback) => !known.has(getValueKey(callback)),
    );
    if (added.length === 0) return;
    this.#storedFunctions.set(storedPlace, [...current, ...added]);
    this.#storedFunctionCount += added.length;
    for (const stored of added)
      if (isMountClosure && stored.kind === "Function") this.addMountClosure(stored);
  }

  getStoredFunctions(place: BindingValue): SymbolicValue[] {
    const prefix = getValuePlace(place);
    const stored = [...this.#storedFunctions].flatMap(([storedPlace, values]) =>
      isPlacePrefix(prefix, storedPlace) ? values : [],
    );
    return [...new Map(stored.map((value) => [getValueKey(value), value])).values()];
  }

  #getCalledFunctions(place: BindingValue): SymbolicValue[] {
    const called = this.#storedFunctions.get(getValuePlace(place)) ?? [];
    const lastSegment = place.path.at(-1);
    if (lastSegment === undefined || !ARRAY_INDEX_PATTERN.test(lastSegment)) return called;
    const container = this.getStoredFunctions({ ...place, path: place.path.slice(0, -1) });
    return [
      ...new Map([...called, ...container].map((value) => [getValueKey(value), value])).values(),
    ];
  }

  callStoredFunctions(
    place: BindingValue,
    argumentValues: SymbolicValue[],
    pathState: PathState,
  ): void {
    this.#callChosen(
      this.#getCalledFunctions(place),
      getStoredLabel(place),
      argumentValues,
      place.binding.loc,
      pathState,
    );
  }

  #callChosen(
    functions: SymbolicValue[],
    label: string,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
  ): void {
    let skipped: SymbolicValue[] = [];
    for (const [index, stored] of functions.entries()) {
      const isChosen = createUnknown(`stored-call:${label}:${index}`, loc);
      const guards = [...pathState.guards, ...skipped, isChosen];
      this.callStoredValue(stored, argumentValues, loc, { ...pathState, guards });
      skipped = [...skipped, negate(isChosen)];
    }
  }

  callStoredValue(
    stored: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    pathState: PathState,
    thisValue?: SymbolicValue,
  ): void {
    const [firstArgument] = argumentValues;
    if (stored.kind === "Function")
      this.callFunction(stored, argumentValues, loc, pathState, thisValue);
    if (stored.kind === "Setter") this.#applySetter(stored, firstArgument, pathState);
    if (stored.kind === "Dispatch") this.#applyDispatch(stored, firstArgument, loc, pathState);
    if (stored.kind === "Bound")
      this.callStoredValue(
        stored.callee,
        [...stored.argumentValues, ...argumentValues],
        loc,
        pathState,
        stored.receiver,
      );
  }

  #getModuleBinding(name: string): Binding | null {
    if (this.#resolver !== this.#componentResolver) {
      const declaration = this.#projectLoaders.loadModuleDeclaration(
        createDeclarationKey(this.#resolver.path, name),
      );
      return declaration?.isWritten ? this.#createModuleBinding(declaration) : null;
    }
    const variable = this.#loadModuleVariable(name);
    return variable
      ? this.#createModuleBinding({
          ...variable,
          isWritten: true,
          isReadOnly: false,
          name,
          resolver: this.#resolver,
        })
      : null;
  }

  #getImportedModuleBinding(localName: string, loc: SourceLocation): Binding | null {
    const declarationKey = this.#resolver.getDeclarationKey(loc);
    const declaration = declarationKey
      ? this.#projectLoaders.loadModuleDeclaration(declarationKey)
      : null;
    if (!declaration) return null;
    const isWrittenHere =
      this.#projectLoaders.loadImportUse(createDeclarationKey(this.#resolver.path, localName)) ===
      "written";
    return declaration.isWritten || isWrittenHere ? this.#createModuleBinding(declaration) : null;
  }

  #loadImportedConstant(localName: string, loc: SourceLocation): SymbolicValue | null {
    const declarationKey = this.#resolver.getDeclarationKey(loc);
    const declaration = declarationKey
      ? this.#projectLoaders.loadModuleDeclaration(declarationKey)
      : null;
    if (!declaration?.initial || declaration.isWritten) return null;
    const use = this.#projectLoaders.loadImportUse(
      createDeclarationKey(this.#resolver.path, localName),
    );
    return declaration.initial.kind === "Primitive" ||
      isStatelessRegExp(declaration.initial) ||
      use === "state" ||
      (declarationKey !== null && this.#projectLoaders.isReadOnlyDeclaration(declarationKey))
      ? declaration.initial
      : null;
  }

  #createModuleBinding(declaration: ProjectModuleDeclaration): Binding {
    return this.createBinding(declaration.name, "module", declaration.loc, {
      initial: declaration.initial,
      scope: "",
      resolver: declaration.resolver,
    });
  }

  #evaluateCallee(
    hirFunction: HIRFunction,
    argumentValues: SymbolicValue[],
    pathState: PathState,
    functionId: number,
    thisValue?: SymbolicValue,
  ): SymbolicValue {
    const updateCount = this.#handlerEffects?.updateCount ?? 0;
    const result = this.#evaluateFunction(
      hirFunction,
      argumentValues,
      pathState,
      functionId,
      thisValue,
    );
    if (this.#mountClosureIds.has(functionId))
      this.#handlerEffects?.forgetRenderValues(updateCount);
    return result;
  }

  loadProjectComponent(declarationKey: string): HIRFunction | null {
    return this.#projectLoaders.loadProjectComponent(declarationKey);
  }

  resolveModuleFunction(value: SymbolicValue): SymbolicValue {
    if (value.kind !== "Global") return value;
    const moduleFunction = this.functions.loadModuleFunction(this.#resolver, value.name);
    if (moduleFunction) return this.#registerFunction(moduleFunction);
    const declarationKey = this.#importDeclarationKeys.get(value);
    const imported = declarationKey
      ? this.#projectLoaders.loadProjectFunction(declarationKey)
      : null;
    if (!imported) return value;
    this.functions.addModule(imported.resolver, imported.loadModuleFunction, imported.hirFunction);
    return this.functions.register(imported.hirFunction, imported.resolver);
  }

  warn(kind: WarningKind, message: string, loc: SourceLocation, prop: string | null = null): void {
    this.diagnostics.warn(kind, message, loc, this.#resolver.fileName, prop);
  }

  #getSetterNextValue(
    setterArgument: SymbolicValue | undefined,
    previousValue: SymbolicValue,
    loc: SourceLocation,
    pathState: PathState,
  ): SymbolicValue {
    const updaterValue = setterArgument && this.resolveModuleFunction(setterArgument);
    if (updaterValue?.kind !== "Function") return setterArgument ?? UNDEFINED_VALUE;
    const reassignedIds = getReassignedIds(this.getCurrentFunction());
    const updater = this.functions.get(updaterValue.functionId);
    return updater?.context.some((place) => reassignedIds.has(place.identifier.id))
      ? createUnknown("deferred-updater", loc)
      : this.callFunction(updaterValue, [previousValue], loc, pathState);
  }

  #applySetter(
    setter: SetterValue,
    setterArgument: SymbolicValue | undefined,
    pathState: PathState,
  ): void {
    const collector = this.#getUpdateCollector();
    const queuedValue = collector.getQueuedValue(setter.binding, pathState);
    const isPendingValue =
      queuedValue.kind !== "Binding" || queuedValue.binding.id !== setter.binding.id;
    const previousValue =
      isPendingValue && this.walker.loopDepth > 0 && setterArgument?.kind === "Function"
        ? createUnknown("loop", setter.binding.loc)
        : queuedValue;
    const nextValue = this.#getSetterNextValue(
      setterArgument,
      previousValue,
      setter.binding.loc,
      pathState,
    );
    collector.recordSetterCall(setter.binding, nextValue, pathState);
  }

  #applyDispatch(
    dispatch: DispatchValue,
    action: SymbolicValue | undefined,
    loc: SourceLocation,
    pathState: PathState,
  ): void {
    const isAsyncAction =
      dispatch.reducer.kind === "Function" &&
      (this.functions.get(dispatch.reducer.functionId)?.async ?? false);
    const collector = this.#getUpdateCollector();
    const nextValue =
      dispatch.reducer.kind === "Function"
        ? this.callFunction(
            dispatch.reducer,
            [collector.getQueuedValue(dispatch.binding, pathState), action ?? UNDEFINED_VALUE],
            loc,
            pathState,
          )
        : createUnknown("dispatch", loc);
    const asyncPathState = isAsyncAction ? getAsyncPathState(pathState) : pathState;
    if (dispatch.pending && isAsyncAction)
      collector.recordSetterCall(dispatch.pending, { kind: "Primitive", value: true }, pathState);
    collector.recordSetterCall(dispatch.binding, nextValue, asyncPathState);
    if (dispatch.pending && isAsyncAction)
      collector.recordSetterCall(
        dispatch.pending,
        { kind: "Primitive", value: false },
        asyncPathState,
      );
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
    if (
      reactExportName === "startTransition" ||
      reactExportName === "flushSync" ||
      isStartTransition(callSite.callee)
    )
      return { kind: "Transition" };
    const hookKind = getHookKind(this.getCurrentFunction().env, callSite.calleePlace.identifier);
    if (hookKind === "Custom") {
      const projectHook =
        this.#findProjectDeclaration(callSite.calleePlace, this.#projectLoaders.loadProjectHook) ??
        this.#findProjectDeclaration(
          callSite.calleePlace,
          this.#projectLoaders.loadProjectFunction,
        );
      if (projectHook)
        return this.#inlinedFunctions.size < MAX_INLINE_DEPTH
          ? { kind: "ProjectHook", projectHook }
          : { kind: "Hook", hookKind };
      const storeKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
      const storeModel = storeKey ? this.externalSources.getStoreModel(storeKey) : undefined;
      if (storeKey && storeModel) return { kind: "Store", storeKey, storeModel };
    }
    if (hookKind !== null) return { kind: "Hook", hookKind };
    const helperTakingCallbacks =
      callSite.callee.kind === "Global" && getPassedCallbacks(callSite.argumentValues).length > 0
        ? this.functions.loadModuleFunction(this.#resolver, callSite.callee.name)
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
    this.functions.addModule(
      handlerHelper.resolver,
      handlerHelper.loadModuleFunction,
      handlerHelper.hirFunction,
    );
    return { kind: "ModuleFunction", hirFunction: handlerHelper.hirFunction };
  }

  #loadPureHelper(callSite: CallSite): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
    const inputPlaces = new PlaceMap<true>();
    for (const argument of callSite.argumentValues) this.collectInputPlaces(argument, inputPlaces);
    const isPure =
      declarationKey !== null &&
      this.#inlinedFunctions.size < MAX_INLINE_DEPTH &&
      !callSite.argumentValues.some((argument) => isCallableValue(argument)) &&
      this.#projectLoaders.loadMutatedParameters(declarationKey).size === 0;
    const helper = isPure ? this.#projectLoaders.loadProjectFunction(declarationKey) : null;
    if (helper)
      this.functions.addModule(helper.resolver, helper.loadModuleFunction, helper.hirFunction);
    return helper;
  }

  #getPureHelperResult(
    helper: ProjectHook | null,
    callSite: CallSite,
    pathState: PathState,
  ): SymbolicValue | null {
    if (!helper) return null;
    const returned = this.#inlineFunction(helper.hirFunction, callSite, pathState);
    return hasUnknownPart(returned) ? null : returned;
  }

  #findProjectDeclaration(calleePlace: Place, load: ProjectHookLoader): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? load(declarationKey) : null;
  }

  #evaluateCall(callSite: CallSite, pathState: PathState): SymbolicValue {
    if (isMemoCacheCall(callSite.callee, callSite.argumentValues)) return MEMO_CACHE_VALUE;
    const element = this.#evaluateElementCall(callSite);
    if (element) return element;
    const modeled =
      coerceBooleanCall(callSite.callee, callSite.argumentValues) ??
      this.iteration.evaluateArrayFrom(
        callSite.callee,
        callSite.argumentValues,
        callSite.loc,
        pathState,
      );
    if (modeled) return modeled;
    this.#recordWholeProps(callSite);
    const target = this.#getCallTarget(callSite);
    this.assertionRecorder.recordInvariant(
      getCalleeName(callSite, target),
      callSite.argumentValues,
      callSite.loc,
      pathState,
    );
    switch (target.kind) {
      case "Portal":
        return target.children;
      case "ProjectHook": {
        this.functions.addModule(
          target.projectHook.resolver,
          target.projectHook.loadModuleFunction,
          target.projectHook.hirFunction,
        );
        const position = callSite.loc === GeneratedSource ? "generated" : callSite.loc.start.index;
        return this.withBindingScope(`${this.#resolver.fileName}:${position}`, () =>
          this.#inlineFunction(target.projectHook.hirFunction, callSite, pathState),
        );
      }
      case "Store":
        return this.storeReads.readStore(target.storeKey, target.storeModel, callSite, pathState);
      case "Hook":
        return this.#evaluateHookCall(target.hookKind, callSite, pathState);
      case "ModuleFunction":
        return this.#inlineFunction(target.hirFunction, callSite, pathState);
      case "Transition":
        return this.#startTransition(callSite, pathState);
      case "Value":
        return this.#callValue(callSite, pathState);
      default:
        return assertExhaustive(target, "Unhandled call target");
    }
  }

  #inlineFunction(
    hirFunction: HIRFunction,
    callSite: CallSite,
    pathState: PathState,
  ): SymbolicValue {
    return this.callFunction(
      this.#registerFunction(hirFunction),
      callSite.argumentValues,
      callSite.loc,
      pathState,
    );
  }

  #startTransition(callSite: CallSite, pathState: PathState): SymbolicValue {
    const [scope] = callSite.argumentValues;
    if (scope) this.#callValue({ ...callSite, callee: scope, argumentValues: [] }, pathState);
    return UNDEFINED_VALUE;
  }

  #callValue(callSite: CallSite, pathState: PathState): SymbolicValue {
    const callee = callSite.callee;
    const [firstArgument] = callSite.argumentValues;
    if (callee.kind === "Global" && callee.module === null && isPureFunction(callee.name))
      return this.#createCallResult(callSite, {
        pureCall: { callee: callee.name, operands: callSite.argumentValues },
      });
    switch (callee.kind) {
      case "Function":
        return this.callFunction(
          callee,
          callSite.argumentValues,
          callSite.loc,
          pathState,
          callSite.thisValue ?? callSite.receiver,
        );
      case "Conditional": {
        const test = getTestExpression(callee);
        return {
          ...callee,
          consequent: this.#evaluateCall(
            { ...callSite, callee: callee.consequent },
            { ...pathState, guards: [...pathState.guards, test] },
          ),
          alternate: this.#evaluateCall(
            { ...callSite, callee: callee.alternate },
            { ...pathState, guards: [...pathState.guards, negate(test)] },
          ),
        };
      }
      case "Setter":
        this.#applySetter(callee, firstArgument, pathState);
        return UNDEFINED_VALUE;
      case "Dispatch":
        this.#applyDispatch(callee, firstArgument, callSite.loc, pathState);
        return UNDEFINED_VALUE;
      case "Bound":
        return this.#evaluateCall(
          {
            ...callSite,
            callee: callee.callee,
            thisValue: callee.receiver,
            argumentValues: [...callee.argumentValues, ...callSite.argumentValues],
          },
          pathState,
        );
      default:
        return this.#callOpaqueValue(callSite, pathState);
    }
  }

  #callOpaqueValue(callSite: CallSite, pathState: PathState): SymbolicValue {
    const callee = callSite.callee;
    if (callee.kind === "Global" && callee.module !== null) this.#handlerEffects?.addImportedCall();
    this.#trackProjectCallMutations(callSite, pathState.guards);
    this.#trackBuiltinMutation(callSite, pathState.guards);
    const isMutatingCall = !this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc);
    if (isMutatingCall) this.#handlerEffects?.addOpaqueCall();
    if (this.#handlerEffects && isMutatingCall && callee.kind === "Binding")
      this.#callBinding(callee, callSite.argumentValues, pathState);
    if (
      isMutatingCall &&
      callee.kind === "Binding" &&
      callee.binding.kind === "ref" &&
      callee.path.length > 1
    )
      this.#handlerEffects?.addPossibleMutation(callee.binding);
    if (this.#handlerEffects || isMutatingCall)
      this.callbacks.passCallbacks(callSite.argumentValues, callSite.loc, pathState);
    const isMemberCallee = callee.kind === "Binding" && callee.path.length > 0;
    const getCalleeCallbacks = () =>
      callSite.receiver === undefined
        ? this.getMemberCallbacks(callee)
        : this.getWrappedCallbacks(callee);
    const calleeCallbacks = this.#handlerEffects && !isMemberCallee ? getCalleeCallbacks() : null;
    if (calleeCallbacks) this.callbacks.passCallbacks(calleeCallbacks, callSite.loc, pathState);
    if (this.#handlerEffects && !calleeCallbacks)
      this.#callChosen(
        this.#getCalledSourceFunctions(callee),
        formatSymbolicValue(callee),
        callSite.argumentValues,
        callSite.loc,
        pathState,
      );
    const iterated =
      this.#handlerEffects &&
      callee.kind === "Unknown" &&
      callee.origin?.kind === "Member" &&
      ITERATION_METHODS.has(callee.origin.property)
        ? callee.origin.object
        : null;
    const [callback] = callSite.argumentValues;
    if (iterated && callback?.kind === "Function")
      this.#callStoredItems(
        callback,
        this.#getCalledSourceFunctions(iterated),
        iterated,
        formatSymbolicValue(iterated),
        callSite.loc,
        pathState,
      );
    if (this.#handlerEffects)
      return createUnknown("call", callSite.loc, {
        kind: "Call",
        callee,
        argumentValues: callSite.argumentValues,
      });
    this.#forgetCallbackWrites(callSite.argumentValues, callSite.loc);
    if (this.#resolver.isReactElement(callSite.loc)) {
      const helper = this.#findProjectDeclaration(
        callSite.calleePlace,
        this.#projectLoaders.loadProjectFunction,
      );
      if (helper && this.#inlinedFunctions.size < MAX_INLINE_DEPTH) {
        this.functions.addModule(helper.resolver, helper.loadModuleFunction, helper.hirFunction);
        return this.#inlineFunction(helper.hirFunction, callSite, pathState);
      }
      this.diagnostics.bailOut(
        "unknown-call",
        "call returns JSX the analysis can't see into",
        this.#resolver === this.#componentResolver
          ? callSite.loc
          : (this.#componentCallLoc ?? callSite.loc),
      );
      return createUnknown("call", callSite.loc);
    }
    const helper = this.#loadPureHelper(callSite);
    const initial = this.#getPureHelperResult(helper, callSite, pathState);
    if (
      initial &&
      helper &&
      !hasLoop(helper.hirFunction) &&
      !addsCallResult(initial, callSite.argumentValues)
    )
      return initial;
    const result = this.#createCallResult(callSite, { initial });
    const callbacks = getPassedCallbacks(callSite.argumentValues);
    const isExternalWrapper = callee.kind === "Binding" && isExternalSource(callee.binding);
    const wrapped = isExternalWrapper ? [callee, ...callbacks] : callbacks;
    if (callbacks.length > 0) this.#wrappedCallbacks.set(result, wrapped);
    if (callbacks.length > 0 && result.kind === "Binding")
      this.#wrappedCallbacksByBinding.set(result.binding.id, wrapped);
    return result;
  }

  #trackProjectCallMutations(callSite: CallSite, guards: SymbolicValue[]): void {
    const declarationKey = this.#resolver.getDeclarationKey(callSite.calleePlace.loc);
    if (!declarationKey) return;
    for (const [index, isPart] of this.#projectLoaders.loadMutatedParameters(declarationKey)) {
      const argumentPlace = callSite.argumentPlaces[index];
      if (argumentPlace) this.mutations.trackArgument(argumentPlace, callSite.loc, guards, isPart);
    }
  }

  #trackBuiltinMutation(callSite: CallSite, guards: SymbolicValue[]): void {
    if (callSite.callee.kind !== "Global" || callSite.callee.module !== null) return;
    const targetIndex =
      BUILTIN_MUTATOR_TARGETS.get(callSite.callee.name) ??
      (PROTOTYPE_MUTATOR_CALL.test(callSite.callee.name) ? 0 : null);
    const argumentPlace = targetIndex === null ? undefined : callSite.argumentPlaces[targetIndex];
    if (argumentPlace) this.mutations.trackArgument(argumentPlace, callSite.loc, guards);
  }

  carryWrappedCallbacks(binding: Binding, value: SymbolicValue): void {
    const callbacks = this.#wrappedCallbacks.get(value);
    if (!callbacks) return;
    const carried = [...(this.#wrappedCallbacksByBinding.get(binding.id) ?? []), ...callbacks];
    this.#wrappedCallbacksByBinding.set(binding.id, [
      ...new Map(carried.map((callback) => [getValueKey(callback), callback])).values(),
    ]);
  }

  getWrappedCallbacks(value: SymbolicValue): SymbolicValue[] | null {
    const byBinding =
      value.kind === "Binding" ? this.#wrappedCallbacksByBinding.get(value.binding.id) : undefined;
    return this.#wrappedCallbacks.get(value) ?? byBinding ?? null;
  }

  addUnknownSource(unknown: SymbolicValue, source: SymbolicValue): void {
    const sourceKeys = this.#unknownSourceKeys.get(unknown) ?? new Set<string>();
    const sourceKey = getValueKey(source);
    if (sourceKeys.has(sourceKey)) return;
    sourceKeys.add(sourceKey);
    this.#unknownSourceKeys.set(unknown, sourceKeys);
    const sources = this.#unknownSources.get(unknown);
    if (!sources) this.#unknownSources.set(unknown, [source]);
    sources?.push(source);
  }

  #getCalledSourceFunctions(callee: SymbolicValue): SymbolicValue[] {
    if (callee.kind === "Binding") {
      const member = callee.path.at(-1);
      const isElement = member === undefined || !isBuiltinMember(member);
      return isElement
        ? this.#getSourceFunctions(this.#sourcesByBinding.get(callee.binding.id) ?? [])
        : [];
    }
    if (callee.kind !== "Unknown") return [];
    const sources = this.#unknownSources.get(callee);
    if (sources) return this.#getSourceFunctions(sources);
    if (!callee.origin) return [];
    if (callee.origin.kind === "Member")
      return isBuiltinMember(callee.origin.property)
        ? []
        : this.#getSourceFunctions([callee.origin.object]);
    return callee.origin.kind === "Call" ? this.#getSourceFunctions([callee.origin.callee]) : [];
  }

  getSourceFunctions(value: SymbolicValue): SymbolicValue[] {
    return this.#getSourceFunctions([value]);
  }

  #getSourceFunctions(
    values: SymbolicValue[],
    seen = new Set<SymbolicValue | number>(),
  ): SymbolicValue[] {
    return values.flatMap((value): SymbolicValue[] => {
      if (seen.has(value)) return [];
      seen.add(value);
      if (isCallableValue(value)) return [value];
      switch (value.kind) {
        case "Conditional":
          return this.#getSourceFunctions([value.consequent, value.alternate], seen);
        case "ArrayExpression":
          return this.#getSourceFunctions([...value.elements, ...value.spreads], seen);
        case "ArrayMap":
          return this.#getSourceFunctions([value.item, value.array], seen);
        case "Collection":
          return this.#getSourceFunctions(
            [
              ...(value.source ? [value.source] : []),
              ...value.writes.flatMap((write) => write.argumentValues),
            ],
            seen,
          );
        case "ObjectExpression":
          return this.#getSourceFunctions(
            [...value.properties.map((property) => property.value), ...value.spreads],
            seen,
          );
        case "Binding": {
          if (seen.has(value.binding.id)) return [];
          seen.add(value.binding.id);
          const sources = this.#sourcesByBinding.get(value.binding.id) ?? [];
          const initial = value.binding.initial ? [value.binding.initial] : [];
          const passed =
            value.binding.kind === "call"
              ? (this.#wrappedCallbacksByBinding.get(value.binding.id) ?? [])
              : [];
          return this.#getSourceFunctions(
            [...sources, ...initial, ...passed, ...this.getStoredFunctions(value)],
            seen,
          );
        }
        case "Unknown": {
          const sources = this.#unknownSources.get(value);
          if (sources) return this.#getSourceFunctions(sources, seen);
          if (value.origin?.kind === "Member")
            return this.#getSourceFunctions([value.origin.object], seen);
          if (value.origin?.kind === "Call")
            return this.#getSourceFunctions(
              value.origin.callee.kind === "Global"
                ? [value.origin.callee, ...value.origin.argumentValues]
                : [value.origin.callee],
              seen,
            );
          return value.origin?.kind === "Value"
            ? this.#getSourceFunctions([value.origin.value], seen)
            : [];
        }
        default:
          return [];
      }
    });
  }

  getMemberCallbacks(receiver: SymbolicValue): SymbolicValue[] | null {
    const own = this.getWrappedCallbacks(receiver);
    if (own || receiver.kind !== "Unknown" || receiver.origin?.kind !== "Member") return own;
    return this.getMemberCallbacks(receiver.origin.object);
  }

  forgetHandlerWrites(handlerCallback: SymbolicValue): void {
    for (const callback of getContainedValues(handlerCallback)) {
      if (callback.kind !== "Function") continue;
      const hirFunction = this.functions.get(callback.functionId);
      if (!hirFunction) continue;
      const { values } = this.getCompilationTables(hirFunction);
      for (const place of getStoredContextPlaces(hirFunction))
        values.set(place.identifier.id, createUnknown("handler-write", callback.loc));
    }
  }

  #forgetCallbackWrites(argumentValues: SymbolicValue[], loc: SourceLocation): void {
    for (const callback of getPassedCallbacks(argumentValues)) {
      if (callback.kind !== "Function") continue;
      const hirFunction = this.functions.get(callback.functionId);
      for (const place of hirFunction ? getWrittenContextPlaces(hirFunction) : [])
        this.write(place, createUnknown("callback-write", loc));
    }
  }

  #callBinding(callee: BindingValue, argumentValues: SymbolicValue[], pathState: PathState): void {
    this.callStoredFunctions(callee, argumentValues, pathState);
    if (callee.binding.kind === "prop")
      this.#handlerEffects?.addDelegate(formatPlace(callee.binding, callee.path));
    const memberName = callee.path.length === 1 ? callee.path[0] : undefined;
    const setterField =
      memberName && this.externalSources.getSetterField(callee.binding, memberName);
    if (setterField) {
      this.#setContextField(callee.binding, setterField, argumentValues[0], pathState);
      return;
    }
    const assignments =
      memberName && this.externalSources.getActionAssignments(callee.binding, memberName);
    if (assignments) {
      const base = this.getQueuedState(callee.binding, pathState);
      const readField = (field: string) =>
        this.evaluatePropertyLoad(base, field, callee.binding.loc);
      this.#handlerEffects?.recordSetterCall(
        callee.binding,
        createFieldUpdate(
          base,
          assignments.map((assignment) => ({
            key: assignment.field,
            value: getStoreFieldValue(callee.binding, assignment, argumentValues, readField),
          })),
        ),
        pathState,
      );
      return;
    }
    if (memberName && this.externalSources.isStoreBinding(callee.binding)) {
      this.#handlerEffects?.recordSetterCall(
        callee.binding,
        createUnknown("store", callee.binding.loc),
        pathState,
      );
      return;
    }
    if (isExternalSource(callee.binding) && this.#handlerEffects)
      this.storeReads.recordExternalUpdate(this.#handlerEffects, callee, pathState);
  }

  #setContextField(
    binding: Binding,
    field: string,
    setterArgument: SymbolicValue | undefined,
    pathState: PathState,
  ): void {
    if (!this.#handlerEffects) return;
    const base = this.getQueuedState(binding, pathState);
    const previousValue = this.evaluatePropertyLoad(base, field, binding.loc);
    const nextValue = this.#getSetterNextValue(
      setterArgument,
      previousValue,
      binding.loc,
      pathState,
    );
    this.#handlerEffects.addUpdate(
      binding,
      createFieldUpdate(base, [
        { key: field, value: this.#handlerEffects.forgetMutatedBindings(nextValue) },
      ]),
      getAsyncPathState(pathState),
    );
  }

  #loadSpreadField(spreads: SymbolicValue[], property: string, loc: SourceLocation): SymbolicValue {
    const [onlySpread] = spreads;
    if (spreads.length === 1 && onlySpread)
      return this.evaluatePropertyLoad(onlySpread, property, loc);
    return spreads.length > 0 ? createUnknown("spread", loc) : UNDEFINED_VALUE;
  }

  getQueuedState(binding: Binding, pathState: PathState): SymbolicValue {
    return this.#handlerEffects?.getQueuedValue(binding, pathState) ?? createBindingValue(binding);
  }

  collectInputPlaces(
    value: SymbolicValue,
    inputPlaces: PlaceMap<true>,
    visited = new Set<number | SymbolicValue>(),
  ): void {
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") inputPlaces.set(getValuePlace(part), true);
      if (part.kind === "Unknown" && !visited.has(part)) {
        visited.add(part);
        for (const source of this.#getUnknownInputs(part))
          this.collectInputPlaces(source, inputPlaces, visited);
      }
      if (part.kind !== "Function" || visited.has(part.functionId)) return;
      visited.add(part.functionId);
      for (const capturedPlace of this.functions.get(part.functionId)?.context ?? [])
        this.collectInputPlaces(this.read(capturedPlace), inputPlaces, visited);
    });
  }

  #getUnknownInputs(unknown: Extract<SymbolicValue, { kind: "Unknown" }>): SymbolicValue[] {
    const sources = this.#unknownSources.get(unknown) ?? [];
    return [...sources, ...(unknown.origin ? getOriginValues(unknown.origin) : [])];
  }

  #hasHiddenInputs(value: SymbolicValue, seen = new Set<SymbolicValue>()): boolean {
    let isHidden = false;
    forEachSymbolicValue(value, (part) => {
      if (isHidden || part.kind !== "Unknown" || seen.has(part)) return;
      seen.add(part);
      isHidden =
        part.reason === "UnsupportedNode" ||
        this.#getUnknownInputs(part).some((source) => this.#hasHiddenInputs(source, seen));
    });
    return isHidden;
  }

  createDerivedValue(
    sourceValues: SymbolicValue[],
    reason: string,
    loc: SourceLocation,
  ): SymbolicValue {
    const inputPlaces = new PlaceMap<true>();
    for (const sourceValue of sourceValues) this.collectInputPlaces(sourceValue, inputPlaces);
    const sourceText = this.#resolver.getSourceText(loc);
    if (inputPlaces.size === 0 || sourceText === null) return createUnknown(reason, loc);
    const binding = this.createBinding(sourceText, "call", loc, {
      inputPlaces: inputPlaces.places(),
    });
    this.#sourcesByBinding.set(binding.id, sourceValues);
    return createBindingValue(binding);
  }

  #getReceiverPlace(callee: SymbolicValue): BindingPlace | null {
    if (callee.kind !== "Binding" || callee.path.length === 0) return null;
    return getBindingPlace(callee.binding, callee.path.slice(0, -1));
  }

  #isLengthLimited(callSite: CallSite, receiverPlace: BindingPlace | null): boolean {
    const methodName = callSite.callee.kind === "Binding" ? callSite.callee.path.at(-1) : undefined;
    if (!receiverPlace || methodName === undefined) return false;
    const isLengthMethod =
      LENGTH_PRESERVING_METHODS.has(methodName) || SHORTENING_METHODS.has(methodName);
    return isLengthMethod && this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc);
  }

  #getLongCallKey(callSite: CallSite): string {
    const valueKeys = [callSite.callee, ...callSite.argumentValues].map(getValueKey);
    return [getLocationKey(callSite.loc), ...valueKeys].join(",");
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
    options: {
      pureCall?: PureCall | null;
      isDerived?: boolean;
      initial?: SymbolicValue | null;
    } = {},
  ): SymbolicValue {
    const pureCall = options.pureCall ?? null;
    const initial = options.initial ?? null;
    const calleeText = this.#resolver.getCalleeText(callSite.loc);
    if (calleeText === null) return createUnknown("call", callSite.loc);
    const inputPlaces = new PlaceMap<true>();
    for (const argument of callSite.argumentValues) this.collectInputPlaces(argument, inputPlaces);
    const receiverPlace = this.#getReceiverPlace(callSite.callee);
    if (!receiverPlace && callSite.callee.kind !== "Function")
      this.collectInputPlaces(callSite.callee, inputPlaces);
    if (receiverPlace && this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc))
      inputPlaces.set(receiverPlace, true);
    if (!receiverPlace && callSite.receiver)
      this.collectInputPlaces(callSite.receiver, inputPlaces);
    const hasUnknownReceiver = !receiverPlace && callSite.receiver?.kind === "Unknown";
    if (hasUnknownReceiver && inputPlaces.size === 0) return createUnknown("call", callSite.loc);
    const isDerivedResult =
      options.isDerived || pureCall !== null || this.#isLengthLimited(callSite, receiverPlace);
    const hasFiniteResult = this.#resolver.getDomain(callSite.loc).kind === "Cases";
    if (!isDerivedResult && !initial && inputPlaces.size === 0 && !hasFiniteResult) {
      const unknownResult = createUnknown("call", callSite.loc);
      this.addUnknownSource(unknownResult, {
        kind: "ArrayExpression",
        elements: [callSite.callee, ...callSite.argumentValues],
        spreads: [],
      });
      return unknownResult;
    }
    if (receiverPlace) inputPlaces.set(receiverPlace, true);
    if (initial) this.collectInputPlaces(initial, inputPlaces);
    if (initial?.kind === "Primitive" && inputPlaces.size === 0 && !isDerivedResult) return initial;
    const sourceValues = [
      callSite.callee,
      ...callSite.argumentValues,
      ...(initial ? [initial] : []),
    ];
    if (inputPlaces.size === 0 && sourceValues.some((value) => this.#hasHiddenInputs(value)))
      return (
        initial ??
        createUnknown("call", callSite.loc, {
          kind: "Call",
          callee: callSite.callee,
          argumentValues: callSite.argumentValues,
        })
      );
    const argumentText = callSite.argumentValues.map(formatSymbolicValue).join(", ");
    const callText = `${calleeText}(${argumentText})`;
    const isLongName = callText.length > MAX_CALL_NAME_LENGTH;
    const domain = pureCall ? getPureCallDomain(pureCall) : null;
    const binding = this.createBinding(
      isLongName ? `${callText.slice(0, MAX_CALL_NAME_LENGTH)}…` : callText,
      "call",
      callSite.loc,
      {
        inputPlaces: inputPlaces.places(),
        isDerived: isDerivedResult,
        identityKey:
          this.#getRepeatableCallKey(callSite) ??
          (isLongName ? this.#getLongCallKey(callSite) : undefined),
        initial,
        ...(domain && { domain }),
      },
    );
    this.#sourcesByBinding.set(
      binding.id,
      callSite.receiver ? [callSite.callee, callSite.receiver] : [callSite.callee],
    );
    return createBindingValue(binding);
  }

  #evaluateHookCall(hookKind: HookKind, callSite: CallSite, pathState: PathState): SymbolicValue {
    const [firstArgument, secondArgument] = callSite.argumentValues;
    if (getHookTraits(hookKind).isEffect) {
      if (firstArgument)
        this.callbacks.addEffectCall(
          hookKind,
          firstArgument,
          callSite.argumentPlaces[1],
          callSite.loc,
        );
      return UNDEFINED_VALUE;
    }
    if (this.#resolver.getReactExportName(callSite.loc) === "useDeferredValue")
      return firstArgument ?? UNDEFINED_VALUE;
    if (hookKind === "Custom")
      this.callbacks.addDeferredCallbacks(callSite.argumentValues, callSite.loc, true);
    if (hookKind === "useImperativeHandle" && secondArgument?.kind === "Function")
      this.callbacks.addDeferredCallbacks(
        [this.callFunction(secondArgument, [], callSite.loc, pathState)],
        callSite.loc,
      );
    if (hookKind === "useMemo" && firstArgument?.kind === "Function")
      return this.callFunction(firstArgument, [], callSite.loc, pathState);
    if ((hookKind === "useCallback" || hookKind === "useEffectEvent") && firstArgument)
      return firstArgument;
    const hookName = callSite.callee.kind === "Global" ? callSite.callee.name : hookKind;
    const hookModule = callSite.callee.kind === "Global" ? callSite.callee.module : null;
    const hookResult: HookResultValue = {
      kind: "HookResult",
      hookKind,
      name: hookName,
      module: hookModule,
      argumentValues: this.#evaluateInitializers(hookKind, callSite, pathState),
      loc: callSite.loc,
    };
    const [contextPlace] = callSite.argumentPlaces;
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
    pathState: PathState,
  ): SymbolicValue[] {
    const [initializer, initialArgument, init] = callSite.argumentValues.map((argument) =>
      this.resolveModuleFunction(argument),
    );
    if (hookKind === "useState" && initializer?.kind === "Function")
      return [
        this.callFunction(initializer, [], callSite.loc, pathState),
        ...callSite.argumentValues.slice(1),
      ];
    if (hookKind !== "useReducer" || !init || !initializer || !initialArgument)
      return callSite.argumentValues;
    const initialState =
      init.kind === "Function"
        ? this.callFunction(init, [initialArgument], callSite.loc, pathState)
        : createUnknown("call", callSite.loc);
    return [initializer, initialState, ...callSite.argumentValues.slice(3)];
  }

  #getCollectionLookup(
    receiver: SymbolicValue,
    methodName: string,
    [key]: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue | null {
    const entries = key && key.kind !== "Primitive" ? getCollectionEntries(receiver) : null;
    if (!key || !entries || (methodName !== "get" && methodName !== "has")) return null;
    if (receiver.kind === "Collection" && receiver.collection === "Set" && methodName === "get")
      return null;
    const fallback: SymbolicValue =
      methodName === "has" ? { kind: "Primitive", value: false } : UNDEFINED_VALUE;
    return [...entries].reduceRight<SymbolicValue>(
      (rest, [entryKey, entryValue]) => ({
        kind: "Conditional",
        test: foldBinary("===", key, { kind: "Primitive", value: entryKey }),
        testKind: "truthy",
        consequent: methodName === "has" ? { kind: "Primitive", value: true } : entryValue,
        alternate: rest,
        branch: this.createBranchSite(loc),
      }),
      fallback,
    );
  }

  #getMembershipTest(
    receiver: SymbolicValue,
    [candidate]: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue | null {
    if (!candidate || receiver.kind !== "ArrayExpression" || receiver.spreads.length > 0)
      return null;
    const isLiteralList = receiver.elements.every(
      (element) => element.kind === "Primitive" && !Number.isNaN(element.value),
    );
    if (!isLiteralList) return null;
    return receiver.elements.reduceRight<SymbolicValue>(
      (rest, element) => {
        const isElement = foldBinary("===", candidate, element);
        return rest.kind === "Primitive" && rest.value === false
          ? isElement
          : {
              kind: "Conditional",
              test: isElement,
              testKind: "truthy",
              consequent: isElement,
              alternate: rest,
              branch: this.createBranchSite(loc),
            };
      },
      { kind: "Primitive", value: false },
    );
  }

  #evaluateMethodCall(
    methodCall: InstructionValueOfKind<"MethodCall">,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue {
    const receiver = this.read(methodCall.receiver);
    const container = this.#getStoredContainer(methodCall, receiver);
    if (container) return container;
    if (!this.#handlerEffects || receiver.kind !== "Binding")
      return this.#evaluateMethodResult(methodCall, instructionId, pathState);
    const methodName = this.getPropertyName(methodCall.property) ?? "";
    const argumentValues = methodCall.args.map((argument) => this.read(getPlaceOrSpread(argument)));
    if (isRefContents(receiver) && REF_CONTAINER_WRITES.has(methodName))
      for (const argument of argumentValues) this.addStoredFunctions(receiver, argument);
    if (isRefContents(receiver) && receiver.path.length === 1)
      this.#dispatchRefEvent(receiver.binding, methodName, pathState);
    const storedFunctions = this.getStoredFunctions(receiver);
    const [callback] = argumentValues;
    if (ITERATION_METHODS.has(methodName) && callback?.kind === "Function")
      this.#callStoredItems(
        callback,
        [...storedFunctions, ...this.#getCalledSourceFunctions(receiver)],
        receiver,
        getStoredLabel(receiver),
        methodCall.loc,
        pathState,
      );
    const result = this.#evaluateMethodResult(methodCall, instructionId, pathState);
    if (STORED_ITEM_READS.has(methodName) && result.kind === "Binding")
      for (const stored of storedFunctions) this.addStoredFunctions(result, stored, false);
    return result;
  }

  #dispatchRefEvent(binding: Binding, methodName: string, pathState: PathState): void {
    const key = `${binding.id}:${methodName}`;
    if (this.#dispatchingRefEvents.has(key)) return;
    const callbacks = this.refEventDispatcher?.(binding.id, methodName) ?? [];
    this.#dispatchingRefEvents.add(key);
    try {
      for (const callback of callbacks)
        this.#runCallback(callback, [EVENT_ARGUMENT], new Set(), pathState);
    } finally {
      this.#dispatchingRefEvents.delete(key);
    }
  }

  #getStoredContainer(
    methodCall: InstructionValueOfKind<"MethodCall">,
    receiver: SymbolicValue,
  ): BindingValue | null {
    if (!this.#handlerEffects || this.getPropertyName(methodCall.property) !== "values")
      return null;
    const [argument] = methodCall.args;
    const isObjectValues =
      receiver.kind === "Global" && receiver.module === null && receiver.name === "Object";
    const container = isObjectValues && argument ? this.read(getPlaceOrSpread(argument)) : receiver;
    const hasStoredFunctions =
      container.kind === "Binding" && this.getStoredFunctions(container).length > 0;
    return hasStoredFunctions && container.kind === "Binding" ? container : null;
  }

  #callStoredItems(
    callback: FunctionValue,
    storedFunctions: SymbolicValue[],
    receiver: SymbolicValue,
    label: string,
    loc: SourceLocation,
    pathState: PathState,
  ): void {
    for (const [index, stored] of storedFunctions.entries()) {
      const isHeld = createUnknown(`stored-item:${label}:${index}`, loc);
      this.callFunction(callback, [stored, createUnknown("item-index", loc), receiver], loc, {
        ...pathState,
        guards: [...pathState.guards, isHeld],
      });
    }
  }

  #evaluateMethodResult(
    methodCall: InstructionValueOfKind<"MethodCall">,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue {
    const receiver = this.read(methodCall.receiver);
    const methodName = this.getPropertyName(methodCall.property) ?? "";
    const argumentPlaces = methodCall.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.read(place));
    const storeResult = this.storeReads.evaluateStoreMethod(
      methodCall,
      receiver,
      methodName,
      argumentValues,
      pathState,
    );
    if (storeResult) return storeResult;
    if (receiver.kind === "Collection" && CHAINED_COLLECTION_WRITES.has(methodName))
      return receiver;
    const literalRead =
      getLiteralRead(receiver, methodName, argumentValues) ??
      this.#readBindingObject(receiver, methodName, argumentValues, methodCall.loc);
    if (literalRead) return literalRead;
    const [atIndex] = argumentValues;
    const atValue =
      methodName === "at" && atIndex !== undefined
        ? this.#readAt(receiver, atIndex, methodCall.loc, instructionId, pathState)
        : null;
    if (atValue) return atValue;
    const lookup = this.#getCollectionLookup(receiver, methodName, argumentValues, methodCall.loc);
    if (lookup) return lookup;
    const invokedArguments =
      INVOKABLE_KINDS.has(receiver.kind) || receiver.kind === "Binding"
        ? getInvokedArguments(methodName, argumentValues)
        : null;
    if (invokedArguments)
      return this.#evaluateCall(
        {
          callee: receiver,
          calleePlace: methodCall.receiver,
          thisValue: argumentValues[0],
          argumentValues: invokedArguments,
          argumentPlaces: methodName === "call" ? argumentPlaces.slice(1) : [],
          loc: methodCall.loc,
        },
        pathState,
      );
    const instance =
      receiver.kind === "Binding" && receiver.path.length === 0 && receiver.binding.initial
        ? receiver.binding.initial
        : receiver;
    const instanceCallbacks = this.#handlerEffects ? this.getMemberCallbacks(instance) : null;
    if (instanceCallbacks)
      this.callbacks.passCallbacks(instanceCallbacks, methodCall.loc, pathState);
    const [callback] = argumentValues;
    if (ITERATION_METHODS.has(methodName))
      this.iteration.visitItemCallback(methodName, callback, methodCall, pathState);
    const isIteratingLiteral =
      this.#handlerEffects !== null &&
      ITERATION_METHODS.has(methodName) &&
      hasLiteralArrayLeaf(receiver) &&
      callback?.kind === "Function";
    const found = this.iteration.evaluateArrayFind(
      methodName,
      receiver,
      callback,
      methodCall.loc,
      pathState,
    );
    if (found) return found;
    const reduced = this.iteration.evaluateLiteralReduce(
      methodName,
      receiver,
      argumentValues,
      methodCall.loc,
      pathState,
    );
    if (reduced) return reduced;
    const setItems =
      this.#handlerEffects !== null && methodName === "forEach" && callback?.kind === "Function"
        ? getSetItems(receiver, methodCall.loc)
        : null;
    if (setItems && callback?.kind === "Function") {
      for (const item of setItems)
        this.callFunction(callback, [item, item, receiver], methodCall.loc, pathState);
      return UNDEFINED_VALUE;
    }
    if (isIteratingLiteral)
      return this.#iterateLiteralArms(
        methodName,
        receiver,
        callback,
        methodCall.loc,
        instructionId,
        pathState,
      );
    if (RENDERED_ITERATION_METHODS.has(methodName) && callback?.kind === "Function")
      return this.iteration.evaluateArrayMap(
        receiver,
        callback,
        methodCall.loc,
        pathState,
        methodName === "flatMap",
      );
    if (PROMISE_METHODS.has(methodName)) {
      this.callbacks.visitPromiseCallbacks(
        methodName,
        receiver,
        argumentValues,
        methodCall.loc,
        pathState,
      );
      return createUnknown("async", methodCall.loc, {
        kind: "Call",
        callee: createUnknown("member", methodCall.loc, {
          kind: "Member",
          object: receiver,
          property: methodName,
        }),
        argumentValues,
      });
    }
    if (methodName === "bind" && BOUND_RECEIVERS.has(receiver.kind))
      return {
        kind: "Bound",
        callee: receiver,
        receiver: argumentValues[0] ?? UNDEFINED_VALUE,
        argumentValues: argumentValues.slice(1),
        loc: methodCall.loc,
      };
    const callSite: CallSite = {
      callee: this.read(methodCall.property),
      calleePlace: methodCall.property,
      receiver,
      argumentValues,
      argumentPlaces,
      loc: methodCall.loc,
    };
    const membership =
      methodName === "includes" && argumentValues.length === 1
        ? this.#getMembershipTest(receiver, argumentValues, methodCall.loc)
        : null;
    if (membership) return membership;
    const isMath = receiver.kind === "Global" && receiver.name === "Math";
    const pureCall = isMath
      ? getMathCall(methodName, argumentValues)
      : getLiteralArrayCall(receiver, methodName, argumentValues);
    if (pureCall) return this.#createCallResult(callSite, { pureCall });
    const getFirstValue = () =>
      this.iteration.getFirstValue(methodName, receiver, argumentValues, methodCall.loc, pathState);
    const firstValue = this.#handlerEffects
      ? this.#withoutEffects(callback, getFirstValue)
      : getFirstValue();
    if (firstValue && this.#handlerEffects) this.#evaluateCall(callSite, pathState);
    if (firstValue) return this.#createCallResult(callSite, { initial: firstValue });
    return (
      this.#evaluateDerivedMethod(receiver, methodName, callSite) ??
      this.#evaluateCall(callSite, pathState)
    );
  }

  #readBindingObject(
    receiver: SymbolicValue,
    methodName: string,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue | null {
    const [target] = argumentValues;
    const isObjectRead =
      this.#handlerEffects !== null &&
      receiver.kind === "Global" &&
      receiver.module === null &&
      receiver.name === "Object" &&
      BINDING_OBJECT_READS.has(methodName);
    if (!isObjectRead || target?.kind !== "Binding" || target.path.length > 1) return null;
    const literal = getLiteralPathValue(target.binding.initial, target.path);
    if (literal?.kind !== "ObjectExpression" || literal.spreads.length > 0) return null;
    const elements = literal.properties.map(({ key }): SymbolicValue => {
      const keyValue: SymbolicValue = { kind: "Primitive", value: key };
      const member = this.evaluatePropertyLoad(target, key, loc);
      if (methodName === "keys") return keyValue;
      if (methodName === "values") return member;
      return { kind: "ArrayExpression", elements: [keyValue, member], spreads: [] };
    });
    return { kind: "ArrayExpression", elements, spreads: [createUnknown("object-read", loc)] };
  }

  #readAt(
    receiver: SymbolicValue,
    atIndex: SymbolicValue,
    loc: SourceLocation,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue | null {
    if (receiver.kind === "Conditional") {
      const readArm = (arm: SymbolicValue) =>
        this.#readAt(arm, atIndex, loc, instructionId, pathState) ??
        this.createDerivedValue([arm, atIndex], "computed-member", loc);
      return {
        ...receiver,
        consequent: readArm(receiver.consequent),
        alternate: readArm(receiver.alternate),
      };
    }
    const isBinding = receiver.kind === "Binding";
    const array =
      receiver.kind === "Binding" && receiver.path.length <= 1
        ? getLiteralPathValue(receiver.binding.initial, receiver.path)
        : receiver;
    if (array?.kind !== "ArrayExpression" || array.spreads.length > 0) return null;
    if (atIndex.kind === "Primitive")
      return isBinding ? null : getLiteralRead(array, "at", [atIndex]);
    const positions = array.elements.flatMap((element, index): Array<[number, SymbolicValue]> => {
      const read = isBinding ? this.evaluatePropertyLoad(receiver, String(index), loc) : element;
      return isBinding
        ? [[index, read]]
        : [
            [index, read],
            [index - array.elements.length, read],
          ];
    });
    return positions.reduceRight<SymbolicValue>(
      (alternate, [position, element]) => ({
        kind: "Conditional",
        test: foldBinary("===", atIndex, { kind: "Primitive", value: position }),
        testKind: "truthy",
        consequent: element,
        alternate,
        branch: this.createBranchSite(loc),
      }),
      this.createDerivedValue([receiver, atIndex], "computed-member", loc),
    );
  }

  #iterateLiteralArms(
    methodName: string,
    receiver: SymbolicValue,
    callback: FunctionValue,
    loc: SourceLocation,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue {
    if (receiver.kind !== "Conditional") {
      if (receiver.kind !== "ArrayExpression") {
        this.callbacks.passCallbacks([callback], loc, pathState);
        return createUnknown("call", loc);
      }
      const results = this.iteration.callForEachItem(
        methodName,
        callback,
        receiver,
        loc,
        pathState,
      );
      return (
        this.iteration.getLiteralResult(methodName, receiver, results) ??
        this.iteration.getOpenResult(methodName, receiver, results, loc) ??
        createUnknown("call", loc, {
          kind: "Call",
          callee: createUnknown("member", loc, {
            kind: "Member",
            object: receiver,
            property: methodName,
          }),
          argumentValues: [callback],
        })
      );
    }
    const test = getTestExpression(receiver);
    return {
      ...receiver,
      consequent: this.#iterateLiteralArms(
        methodName,
        receiver.consequent,
        callback,
        loc,
        instructionId,
        { ...pathState, guards: [...pathState.guards, test] },
      ),
      alternate: this.#iterateLiteralArms(
        methodName,
        receiver.alternate,
        callback,
        loc,
        instructionId,
        { ...pathState, guards: [...pathState.guards, negate(test)] },
      ),
    };
  }

  #evaluateDerivedMethod(
    receiver: SymbolicValue,
    methodName: string,
    callSite: CallSite,
  ): SymbolicValue | null {
    const isReadOnlyCollectionCall =
      isCollectionRead(methodName) && this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc);
    if (!isStringMethod(methodName) && !isReadOnlyCollectionCall) return null;
    const argumentValues = callSite.argumentValues.flatMap((argument) =>
      argument.kind === "Primitive" ? [argument.value] : [],
    );
    if (argumentValues.length !== callSite.argumentValues.length) return null;
    if (receiver.kind === "Primitive" && typeof receiver.value === "string")
      return {
        kind: "Primitive",
        value: applyStringMethod(methodName, receiver.value, argumentValues),
      };
    const collectionResult =
      receiver.kind === "Collection"
        ? applyCollectionMethod(receiver, methodName, argumentValues)
        : null;
    if (collectionResult !== null) return { kind: "Primitive", value: collectionResult };
    if (receiver.kind === "Collection")
      return this.#readCollection(receiver, methodName, argumentValues, callSite);
    if (receiver.kind !== "Binding") return null;
    return this.#createCallResult(callSite, {
      isDerived: true,
    });
  }

  #readCollection(
    collection: CollectionValue,
    methodName: string,
    argumentValues: PrimitiveValue[],
    callSite: CallSite,
  ): SymbolicValue | null {
    const [key] = argumentValues;
    const missing: SymbolicValue = {
      kind: "Primitive",
      value: methodName === "has" ? false : undefined,
    };
    for (const write of collection.writes.toReversed()) {
      if (write.guards.length > 0) return null;
      if (write.method === "clear") return missing;
      const [writtenKey, writtenValue] = write.argumentValues;
      if (writtenKey?.kind !== "Primitive") return null;
      if (!isSameValueZero(writtenKey.value, key)) continue;
      if (write.method === "delete") return missing;
      if (methodName === "has") return { kind: "Primitive", value: true };
      return write.method === "set" ? (writtenValue ?? UNDEFINED_VALUE) : null;
    }
    const entryValue =
      collection.collection === "Map" && methodName === "get" && collection.writes.length === 0
        ? getLiteralEntryValue(collection.source, key)
        : null;
    if (entryValue) return entryValue;
    if (!collection.isCopy || collection.source?.kind !== "Binding") return null;
    return this.#evaluateDerivedMethod(collection.source, methodName, {
      ...callSite,
      callee: { ...collection.source, path: [...collection.source.path, methodName] },
    });
  }

  evaluateInstruction(instruction: Instruction, pathState: PathState): void {
    this.#recordLoadedProperty(instruction);
    this.mutations.recordAliasSources(instruction);
    this.mutations.track(instruction, pathState);
    const instructionResult = this.#evaluateInstructionValue(instruction, pathState);
    if (
      instruction.value.kind === "ArrayExpression" ||
      instruction.value.kind === "ObjectExpression" ||
      instruction.value.kind === "NewExpression"
    )
      this.mutations.recordCreation(instructionResult, pathState);
    this.write(instruction.lvalue, instructionResult);
    this.mutations.trackPossibleMutations(instruction, pathState);
  }

  #evaluateInstructionValue(instruction: Instruction, pathState: PathState): SymbolicValue {
    const value = instruction.value;
    switch (value.kind) {
      case "Primitive":
        return { kind: "Primitive", value: value.value };
      case "JSXText":
        return { kind: "JSXText", value: value.value };
      case "LoadLocal":
        return this.read(value.place);
      case "LoadContext":
        return this.#evaluateLoadContext(value, pathState);
      case "StoreLocal":
      case "StoreContext":
        return this.#evaluateStoreLocal(value, pathState);
      case "DeclareLocal":
      case "DeclareContext":
        this.write(value.lvalue.place, UNDEFINED_VALUE);
        return UNDEFINED_VALUE;
      case "Destructure":
        this.destructurer.destructure(value);
        return this.read(value.value);
      case "LoadGlobal": {
        const isModuleLocal = value.binding.kind === "ModuleLocal";
        const isImport =
          value.binding.kind === "ImportSpecifier" || value.binding.kind === "ImportDefault";
        const variable = isModuleLocal
          ? this.#getModuleBinding(value.binding.name)
          : isImport
            ? this.#getImportedModuleBinding(value.binding.name, value.loc)
            : null;
        if (variable) return createBindingValue(variable);
        const constant =
          isModuleLocal || value.binding.kind === "Global"
            ? this.#loadModuleConstant(value.binding.name)
            : isImport
              ? this.#loadImportedConstant(value.binding.name, value.loc)
              : null;
        const global = constant ?? this.#foldLiteralType(getGlobalValue(value), value.loc);
        const declarationKey = isImport ? this.#resolver.getDeclarationKey(value.loc) : null;
        if (declarationKey) this.#importDeclarationKeys.set(global, declarationKey);
        return global;
      }
      case "PropertyLoad":
        return this.#evaluatePropertyLoad(value, pathState);
      case "ComputedLoad":
        return this.#evaluateComputedLoad(value, instruction.id, pathState);
      case "BinaryExpression":
        return foldBinary(value.operator, this.read(value.left), this.read(value.right));
      case "UnaryExpression":
        return foldUnary(value.operator, this.read(value.value));
      case "TypeCastExpression":
        return this.assertionRecorder.evaluateTypeCast(value, pathState);
      case "ObjectExpression":
        return this.#evaluateObjectLiteral(value);
      case "ArrayExpression":
        return this.#evaluateArrayLiteral(value);
      case "FunctionExpression":
      case "ObjectMethod": {
        const lexicalThis =
          value.kind === "FunctionExpression" &&
          value.type === "ArrowFunctionExpression" &&
          this.#currentFunction
            ? this.#thisValues.get(this.#currentFunction)
            : undefined;
        if (lexicalThis) this.#thisValues.set(value.loweredFunc.func, lexicalThis);
        return this.#createClosure(value.loweredFunc.func);
      }
      case "CallExpression":
        return this.#evaluateCallExpression(value, pathState);
      case "MethodCall":
        return this.#evaluateMethodCall(value, instruction.id, pathState);
      case "JsxExpression":
        return this.#evaluateJsxElement(value);
      case "JsxFragment":
        return {
          kind: "JsxFragment",
          children: flattenArrayChildren(value.children.map((child) => this.read(child))),
        };
      case "Await":
        return createUnknown("async", value.loc, {
          kind: "Settled",
          promise: this.read(value.value),
          outcome: "fulfilled",
        });
      case "NewExpression": {
        const argumentValues = value.args.map((argument) => this.read(getPlaceOrSpread(argument)));
        this.callbacks.passCallbacks(argumentValues, value.loc, pathState);
        const constructor = this.read(value.callee);
        const collection =
          constructor.kind === "Global" && constructor.module === null
            ? COLLECTION_CONSTRUCTORS.get(constructor.name)
            : undefined;
        const [sourcePlace] = value.args;
        if (collection && value.args.every((argument) => argument.kind === "Identifier"))
          return {
            kind: "Collection",
            collection,
            source: argumentValues[0] ?? null,
            isCopy:
              sourcePlace?.kind === "Identifier" &&
              this.#resolver.getCollectionName(sourcePlace.loc) === collection,
            writes: [],
            loc: value.loc,
          };
        const callbacks = getPassedCallbacks(argumentValues);
        if (!this.#handlerEffects && callbacks.length === 0)
          return this.createDerivedValue([constructor, ...argumentValues], value.kind, value.loc);
        const instance = createUnknown(value.kind, value.loc);
        if (callbacks.length > 0) this.#wrappedCallbacks.set(instance, callbacks);
        return instance;
      }
      case "PropertyStore":
        return this.#evaluatePropertyStore(value, pathState);
      case "ComputedStore": {
        this.callbacks.passStoredCallback(value, pathState);
        const object = this.read(value.object);
        const storedValue = this.read(value.value);
        if (object.kind === "Unknown") this.addUnknownSource(object, storedValue);
        return storedValue;
      }
      case "PrefixUpdateLocal":
      case "PrefixUpdateContext":
        return this.#evaluateUpdateLocal(value, true, pathState);
      case "PostfixUpdateLocal":
      case "PostfixUpdateContext":
        return this.#evaluateUpdateLocal(value, false, pathState);
      case "TemplateLiteral":
        return this.#evaluateTemplateLiteral(value);
      case "StoreGlobal": {
        const variable = this.#getModuleBinding(value.name);
        if (variable) this.addStoredFunctions(createBindingValue(variable), this.read(value.value));
        if (variable && this.#handlerEffects) this.#handlerEffects.addPossibleMutation(variable);
        if (variable && !this.#handlerEffects) this.bindingTable.forgetInitial(variable);
        return createUnknown(value.kind, value.loc);
      }
      case "IteratorNext":
        return this.iteration.createLoopItem(this.read(value.collection), value.loc);
      case "RegExpLiteral":
        return { kind: "RegExp", pattern: value.pattern, flags: value.flags };
      case "TaggedTemplateExpression":
      case "MetaProperty":
      case "GetIterator":
      case "NextPropertyOf":
      case "PropertyDelete":
      case "ComputedDelete":
        return createUnknown(value.kind, value.loc);
      case "UnsupportedNode":
        return (
          (value.node.type === "ThisExpression" &&
            this.#thisValues.get(this.getCurrentFunction())) ||
          createUnknown(value.kind, value.loc)
        );
      case "StartMemoize":
        this.memoStaleness.startMemoize(value);
        return UNDEFINED_VALUE;
      case "FinishMemoize":
        this.memoStaleness.finishMemoize(value);
        this.memoStaleness.bindMutatedMemo(value);
        return UNDEFINED_VALUE;
      case "Debugger":
        return UNDEFINED_VALUE;
      default:
        return assertExhaustive(value, "Unhandled instruction value");
    }
  }

  #evaluatePropertyLoad(
    load: InstructionValueOfKind<"PropertyLoad">,
    pathState: PathState,
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
    if (isUnsharedRef)
      for (const callback of getPassedCallbacks([initialRef]))
        if (callback.kind === "Function") this.#mountClosureIds.add(callback.functionId);
    if (isUnsharedRef) return initialRef;
    const loaded = this.#foldLiteralType(
      this.evaluatePropertyLoad(object, property, load.loc),
      load.loc,
    );
    if (!this.#handlerEffects || !isRefCell(object, property)) return loaded;
    const cellValue = this.cells.read(getRefCellKey(object.binding), loaded, load.loc, pathState);
    const isUnstoredAsyncRead =
      cellValue.kind === "Unknown" &&
      cellValue.reason === "async" &&
      getPassedCallbacks([object.binding.initial ?? UNDEFINED_VALUE]).length > 0;
    return isUnstoredAsyncRead
      ? {
          kind: "Conditional",
          test: cellValue,
          testKind: "truthy",
          consequent: cellValue,
          alternate: loaded,
          branch: this.createBranchSite(load.loc),
        }
      : cellValue;
  }

  #evaluatePropertyStore(
    store: InstructionValueOfKind<"PropertyStore">,
    pathState: PathState,
  ): SymbolicValue {
    this.callbacks.passStoredCallback(store, pathState);
    const object = this.read(store.object);
    const storedValue = this.read(store.value);
    if (object.kind === "Unknown") this.addUnknownSource(object, storedValue);
    const setter = getSetterAccessor(object, String(store.property));
    if (setter) this.callFunction(setter, [storedValue], store.loc, pathState, object);
    if (isRefCell(object, String(store.property))) {
      this.addStoredFunctions({ ...object, path: ["current"] }, storedValue);
      this.carryWrappedCallbacks(object.binding, storedValue);
    }
    if (object.kind === "Binding" && isRefContents(object))
      this.addStoredFunctions(
        { ...object, path: [...object.path, String(store.property)] },
        storedValue,
      );
    if (this.#handlerEffects && isRefCell(object, String(store.property))) {
      this.cells.store(getRefCellKey(object.binding), storedValue, pathState);
      this.#handlerEffects.addPossibleMutation(object.binding);
    }
    if (!this.#handlerEffects && isRefCell(object, String(store.property)))
      this.bindingTable.forgetInitial(object.binding);
    return storedValue;
  }

  #evaluateLoadContext(
    load: InstructionValueOfKind<"LoadContext">,
    pathState: PathState,
  ): SymbolicValue {
    const loaded = this.read(load.place);
    const isConstant = this.#constantContextIds.has(load.place.identifier.id);
    return this.#handlerEffects && !isConstant
      ? this.cells.read(getContextCellKey(load.place), loaded, load.loc, pathState)
      : loaded;
  }

  #evaluateUpdateLocal(
    update: InstructionValueOfKind<
      "PrefixUpdateLocal" | "PrefixUpdateContext" | "PostfixUpdateLocal" | "PostfixUpdateContext"
    >,
    isPrefix: boolean,
    pathState: PathState,
  ): SymbolicValue {
    const isContextCell =
      this.#handlerEffects !== null &&
      (update.kind === "PrefixUpdateContext" || update.kind === "PostfixUpdateContext");
    const cellKey = getContextCellKey(update.lvalue);
    const loaded = this.read(update.value);
    const previous = isContextCell
      ? this.cells.read(cellKey, loaded, update.loc, pathState)
      : loaded;
    const next = foldBinary(update.operation === "++" ? "+" : "-", previous, ONE_VALUE);
    this.write(update.lvalue, next);
    if (isContextCell) this.cells.store(cellKey, next, pathState);
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
    pathState: PathState,
  ): SymbolicValue {
    const storedValue = this.read(store.value);
    if (store.kind === "StoreContext" && CONSTANT_DECLARATION_KINDS.has(store.lvalue.kind))
      this.#constantContextIds.add(store.lvalue.place.identifier.id);
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
      this.cells.store(getContextCellKey(store.lvalue.place), localValue, pathState);
    return localValue;
  }

  #evaluateComputedLoad(
    computedLoad: InstructionValueOfKind<"ComputedLoad">,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue {
    return this.#loadComputedMember(
      this.read(computedLoad.object),
      this.read(computedLoad.property),
      computedLoad,
      instructionId,
      pathState,
    );
  }

  #loadComputedMember(
    object: SymbolicValue,
    propertyKey: SymbolicValue,
    computedLoad: InstructionValueOfKind<"ComputedLoad">,
    instructionId: InstructionId,
    pathState: PathState,
  ): SymbolicValue {
    if (object.kind === "Conditional" && propertyKey.kind !== "Primitive")
      return {
        ...object,
        consequent: this.#loadComputedMember(
          object.consequent,
          propertyKey,
          computedLoad,
          instructionId,
          pathState,
        ),
        alternate: this.#loadComputedMember(
          object.alternate,
          propertyKey,
          computedLoad,
          instructionId,
          pathState,
        ),
      };
    const bindingLiteral =
      object.kind === "Binding" && object.path.length <= 1
        ? getLiteralPathValue(object.binding.initial, object.path)
        : null;
    const bindingEntries =
      propertyKey.kind === "Primitive" || !bindingLiteral
        ? null
        : getLiteralEntries(bindingLiteral);
    const entries =
      propertyKey.kind === "Primitive"
        ? null
        : bindingEntries
          ? bindingEntries.map(([key]): [string | number, SymbolicValue] => [
              key,
              this.evaluatePropertyLoad(object, String(key), computedLoad.loc),
            ])
          : getLiteralEntries(object);
    const keyType = getDomainPrimitive(
      propertyKey.kind === "Binding" && propertyKey.path.length === 0
        ? propertyKey.binding.domain
        : this.#resolver.getDomain(computedLoad.property.loc),
    );
    if (entries) {
      const keyedEntries = entries.flatMap(([key, entry]) =>
        getPropertyKeyForms(key, keyType).map((keyForm): [PrimitiveValue, SymbolicValue] => [
          keyForm,
          entry,
        ]),
      );
      return keyedEntries.reduceRight<SymbolicValue>(
        (alternate, [keyForm, entry]) => ({
          kind: "Conditional",
          test: foldBinary("===", propertyKey, { kind: "Primitive", value: keyForm }),
          testKind: "truthy",
          consequent: entry,
          alternate,
          branch: this.createBranchSite(computedLoad.loc),
        }),
        bindingEntries
          ? this.createDerivedValue([object, propertyKey], "computed-member", computedLoad.loc)
          : UNDEFINED_VALUE,
      );
    }
    if (propertyKey.kind !== "Primitive" || isNullish(propertyKey.value))
      return this.createDerivedValue([object, propertyKey], "computed-member", computedLoad.loc);
    return this.evaluatePropertyLoad(object, String(propertyKey.value), computedLoad.loc);
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
      if (key === null)
        return createUnknown("computed-key", objectLiteral.loc, {
          kind: "Value",
          value: {
            kind: "ArrayExpression",
            elements: objectLiteral.properties.map((entry) => this.read(entry.place)),
            spreads: [],
          },
        });
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
    pathState: PathState,
  ): SymbolicValue {
    const argumentPlaces = call.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.read(place));
    const mapped = this.iteration.evaluateLoadedArrayMap(call, argumentValues, pathState);
    if (mapped) return mapped;
    const receiverPlace = this.getPropertyObject(call.callee);
    return this.#evaluateCall(
      {
        callee: this.read(call.callee),
        calleePlace: call.callee,
        receiver: receiverPlace && this.read(receiverPlace),
        argumentValues,
        argumentPlaces,
        loc: call.loc,
      },
      pathState,
    );
  }

  getPropertyName(place: Place): string | null {
    return this.getCompilationTables().propertyNames.get(place.identifier.id) ?? null;
  }

  getPropertyObject(place: Place): Place | undefined {
    return this.getCompilationTables().propertyObjects.get(place.identifier.id);
  }

  #recordLoadedProperty(instruction: Instruction): void {
    const tables = this.getCompilationTables();
    if (instruction.value.kind === "PropertyLoad") {
      tables.propertyNames.set(
        instruction.lvalue.identifier.id,
        String(instruction.value.property),
      );
      tables.propertyObjects.set(instruction.lvalue.identifier.id, instruction.value.object);
      return;
    }
    const [from, to] =
      instruction.value.kind === "StoreLocal"
        ? [instruction.value.value, instruction.value.lvalue.place]
        : instruction.value.kind === "LoadLocal"
          ? [instruction.value.place, instruction.lvalue]
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
    if (!providedValue || !contextKey) return;
    if (this.#projectLoaders.loadHeldContexts().has(contextKey))
      this.memoStaleness.captureHeldProps([providedValue], ALL_HELD_PROPS);
    this.providedContexts.push({ contextKey, value: providedValue.value });
  }

  #evaluateJsxElement(element: InstructionValueOfKind<"JsxExpression">): SymbolicValue {
    const props = this.#readJsxProps(element);
    this.#recordProvidedContext(element, props);
    const isBuiltinTag = element.tag.kind === "BuiltinTag";
    const reactExport = isBuiltinTag ? null : this.#resolver.getReactExportName(element.tag.loc);
    const declaration = isBuiltinTag ? null : this.#resolver.getDeclarationKey(element.tag.loc);
    if (declaration)
      this.memoStaleness.captureHeldProps(props, this.#projectLoaders.loadHeldProps(declaration));
    const jsxValue = buildJsx(
      this.#getJsxTag(element.tag),
      {
        declaration,
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
      ? this.#buildSuspense(jsxValue)
      : jsxValue;
  }

  #evaluateElementCall(callSite: CallSite): SymbolicValue | null {
    if (callSite.callee.kind !== "Global" || !callSite.callee.module) return null;
    const isCreateElement =
      callSite.callee.module === "react" && callSite.callee.name.endsWith("createElement");
    if (!isCreateElement && !JSX_RUNTIME_MODULES.has(callSite.callee.module)) return null;
    const [type, props, ...extraArguments] = callSite.argumentValues;
    const [typePlace] = callSite.argumentPlaces;
    if (!type || !typePlace) return null;
    const isBuiltinTag = type.kind === "Primitive" && typeof type.value === "string";
    const properties = props?.kind === "ObjectExpression" ? props.properties : [];
    const childrenProperty = properties.findLast((property) => property.key === "children");
    const elementProps = [
      ...properties
        .filter((property) => isCreateElement || property.key !== "children")
        .map((property): JsxProp => ({
          kind: "JsxAttribute",
          name: property.key,
          value: property.value,
          handlerId: null,
          loc: property.value.kind === "Function" ? property.value.loc : callSite.loc,
          file: this.#resolver.fileName,
        })),
      ...(props?.kind === "ObjectExpression"
        ? props.spreads
        : props && !isNullishValue(props)
          ? [props]
          : []
      ).map((spread): JsxSpreadProp => ({
        kind: "JsxSpreadAttribute",
        value: spread,
        handlerId: null,
        loc: callSite.loc,
        file: this.#resolver.fileName,
      })),
    ];
    const children = isCreateElement
      ? extraArguments
      : childrenProperty?.value.kind === "ArrayExpression"
        ? childrenProperty.value.elements
        : childrenProperty
          ? [childrenProperty.value]
          : [];
    return buildJsx(
      type,
      {
        declaration: isBuiltinTag ? null : this.#resolver.getDeclarationKey(typePlace.loc),
        isContext: !isBuiltinTag && this.#resolver.isContext(typePlace.loc),
        reactExport: isBuiltinTag ? null : this.#resolver.getReactExportName(typePlace.loc),
        props: elementProps,
        children: flattenArrayChildren(children),
        loc: callSite.loc,
        file: this.#resolver.fileName,
      },
      this.renderedComponents,
    );
  }

  createBranchSite(loc: SourceLocation, testKind: TestKind | null = null): BranchSite {
    return { loc, file: this.#resolver.fileName, testKind };
  }

  #evaluateFunction(
    hirFunction: HIRFunction,
    argumentValues: SymbolicValue[],
    pathState: PathState,
    functionId: number | null = null,
    thisValue?: SymbolicValue,
  ): SymbolicValue {
    const previousFunction = this.#currentFunction;
    const previousResolver = this.#resolver;
    const previousFunctionScope = this.walker.functionScope;
    this.walker.functionScope = createFunctionScope();
    this.#currentFunction = hirFunction;
    if (thisValue) this.#thisValues.set(hirFunction, thisValue);
    this.#resolver = this.functions.getResolver(hirFunction) ?? previousResolver;
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
            : nameUnknownArgument(
                argumentValues[parameterIndex] ?? UNDEFINED_VALUE,
                getIdentifierName(parameterPlace),
              ),
        );
      });
      const completion = this.walker.walk(
        hirFunction.body.entry,
        NO_STOPS,
        null,
        pathState,
        "unresolved",
      );
      this.walker.mergeReturnedContextValues(completion, pathState.guards);
      return this.walker.getCompletionValue(completion, hirFunction.loc, pathState.guards);
    } finally {
      this.#frameClosureIds.pop();
      const outerIdentifierIds = new Set(hirFunction.context.map((place) => place.identifier.id));
      for (const closureId of closureIds)
        this.functions.setCapturedValues(
          closureId,
          this.functions
            .getCapturedValues(closureId)
            .map(([place, value]): CapturedValue => [
              place,
              outerIdentifierIds.has(place.identifier.id) ? value : this.read(place),
            ]),
        );
      restoreLiveValues();
      if (thisValue) this.#thisValues.delete(hirFunction);
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
    pathState: PathState = ROOT_PATH_STATE,
    thisValue?: SymbolicValue,
  ): SymbolicValue | null {
    if (callback.kind === "Conditional") {
      const test = getTestExpression(callback);
      const consequentPathState = { ...pathState, guards: [...pathState.guards, test] };
      const alternatePathState = { ...pathState, guards: [...pathState.guards, negate(test)] };
      this.#runCallback(
        callback.consequent,
        argumentValues,
        new Set(visitedFunctionIds),
        consequentPathState,
        thisValue,
      );
      this.#runCallback(
        callback.alternate,
        argumentValues,
        new Set(visitedFunctionIds),
        alternatePathState,
        thisValue,
      );
      return null;
    }
    if (callback.kind === "Bound")
      return this.#runCallback(
        callback.callee,
        [...callback.argumentValues, ...argumentValues],
        visitedFunctionIds,
        pathState,
        callback.receiver,
      );
    if (callback.kind === "Setter")
      this.#handlerEffects?.recordSetterCall(
        callback.binding,
        argumentValues[0] ?? EVENT_ARGUMENT,
        pathState,
      );
    if (callback.kind === "Dispatch")
      this.#applyDispatch(callback, argumentValues[0], callback.binding.loc, pathState);
    if (callback.kind === "Binding") this.#callBinding(callback, argumentValues, pathState);
    if (callback.kind === "Unknown") {
      const memberCallbacks = this.getMemberCallbacks(callback);
      if (memberCallbacks) this.callbacks.passCallbacks(memberCallbacks, callback.loc, pathState);
    }
    if (callback.kind !== "Function" || visitedFunctionIds.has(callback.functionId)) return null;
    visitedFunctionIds.add(callback.functionId);
    const hirFunction = this.functions.get(callback.functionId);
    if (!hirFunction) return null;
    const externalArguments = hirFunction.params.map(
      (_parameter, index) =>
        argumentValues[index] ?? createUnknown("callback-argument", callback.loc),
    );
    const result = this.#evaluateCallee(
      hirFunction,
      externalArguments,
      pathState,
      callback.functionId,
      thisValue,
    );
    this.#runRenderedHandlers(result, visitedFunctionIds);
    return result;
  }
}
