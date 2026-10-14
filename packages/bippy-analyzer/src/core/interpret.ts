import type {
  ArrayPattern,
  BasicBlock,
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  ObjectPattern,
  Phi,
  Place,
  SourceLocation,
  Terminal,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource, getHookKind } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import type { AliasingEffect } from "../react-compiler/Inference/AliasingEffects";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { DomainResolver } from "./infer-domains";
import type {
  ArrayExpressionValue,
  Binding,
  BindingKind,
  BindingPlace,
  BindingValue,
  ContextSetterFields,
  Branch,
  DispatchValue,
  Domain,
  FunctionValue,
  HookResultValue,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  LengthLimit,
  ObjectExpressionValue,
  ProvidedContext,
  Sample,
  StoreActions,
  SetterValue,
  SymbolicValue,
  TestKind,
  WarningKind,
} from "./types";
import { formatPlace, formatSymbolicValue } from "./format";
import { forEachJsxElement, forEachSymbolicValue } from "./utils/traverse";
import { EVENT_ARGUMENT, isHandlerProp } from "./collect-handlers";
import { PlaceMap, getBindingPlace, getValuePlace } from "./utils/place";
import { isExternalSource, isNullish, isNullishValue, isStateBinding } from "./utils/checks";
import { getTestExpression, negate } from "./utils/truthiness";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  foldUnary,
  getKnownOutcome,
  getPassedCallbacks,
  getShortCircuit,
} from "./symbolic-values";
import { BindingTable } from "./binding-table";
import type { BindingOptions } from "./binding-table";
import { buildJsx } from "./build-jsx";
import { Diagnostics } from "./diagnostics";
import { EffectCollector } from "./effect-collector";
import type { CollectedEffects } from "./effect-collector";
import { ExternalSources, getHookBindingKind, getStoreFieldValue } from "./external-sources";
import { FunctionRegistry } from "./function-registry";
import type { CapturedValue, ModuleFunctionLoader } from "./function-registry";
import {
  NO_STOPS,
  createConditional,
  getGuard,
  getLoopExit,
  getLoopHeaders,
  hasFallthrough,
  isFallthroughOnly,
  mapFallthroughs,
} from "./control-flow";
import type { BranchTerminal, LoopTerminal, Outcome } from "./control-flow";
import { eachTerminalSuccessor } from "../react-compiler/HIR/visitors";
import {
  getDeclarationLocation,
  getIdentifierName,
  getConditionallyMutatedPlace,
  getMutatedPlace,
  getPlaceOrSpread,
  isFunctionCreation,
} from "./utils/hir";

const MAX_BLOCK_VISITS = 20_000;
const MAX_INLINE_DEPTH = 4;
const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic", "useActionState"]);
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const SHORTENING_METHODS = new Set(["filter", "slice"]);
const LENGTH_PRESERVING_METHODS = new Set(["toReversed", "toSorted", "with"]);
const ITERATION_METHODS = new Set(["forEach", "map", "filter", "some", "every", "find", "flatMap"]);
const ROOT_WALK_STATE: WalkState = { guards: [], isAsync: false };

const ASSERTED_DOMAIN: Domain = { kind: "Unknown", reason: "cast" };
const SUSPENDED_DOMAIN: Domain = {
  kind: "Cases",
  cases: [
    { kind: "Literal", value: true },
    { kind: "Literal", value: false },
  ],
  origin: "type",
};

type InstructionValueOfKind<Kind extends InstructionValue["kind"]> = Extract<
  InstructionValue,
  { kind: Kind }
>;

const getAsyncWalkState = (walkState: WalkState): WalkState => ({ ...walkState, isAsync: true });

const createFieldUpdate = (
  binding: Binding,
  properties: ObjectExpressionValue["properties"],
): ObjectExpressionValue => ({
  kind: "ObjectExpression",
  properties,
  spreads: [createBindingValue(binding)],
});

const getGlobalValue = (loadGlobal: InstructionValueOfKind<"LoadGlobal">): SymbolicValue => {
  const { binding } = loadGlobal;
  if (binding.kind === "Global" && binding.name === "undefined") return UNDEFINED_VALUE;
  return {
    kind: "Global",
    name: binding.name,
    module: "module" in binding ? binding.module : null,
  };
};

type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "optional-chain-tail";

type ValueBranchTerminal = Extract<Terminal, { kind: "ternary" | "logical" | "optional" }>;

type TerminalStep = Outcome | { kind: "Next"; block: BlockId };

const getBranchOperator = (terminal: ValueBranchTerminal): BranchOperator => {
  if (terminal.kind === "logical") return terminal.operator;
  if (terminal.kind === "optional" && !terminal.optional) return "optional-chain-tail";
  return terminal.kind;
};

interface InterpreterBindingOptions extends BindingOptions {
  resolver?: DomainResolver;
}

interface WalkState {
  guards: SymbolicValue[];
  isAsync: boolean;
}

interface CreationPath {
  guards: SymbolicValue[];
  loopDepth: number;
}

interface EffectCall {
  hookKind: HookKind;
  callback: SymbolicValue;
  callbackArguments: SymbolicValue[];
  dependencies: string | null;
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
  branchOperators: Map<BlockId, BranchOperator>;
}

type CallTarget =
  | { kind: "Portal"; children: SymbolicValue }
  | { kind: "ProjectHook"; projectHook: ProjectHook }
  | { kind: "Store"; storeKey: string; storeActions: StoreActions }
  | { kind: "Hook"; hookKind: HookKind }
  | { kind: "ModuleFunction"; hirFunction: HIRFunction }
  | { kind: "Value" };

export interface ProjectHook {
  hirFunction: HIRFunction;
  resolver: DomainResolver;
  loadModuleFunction: ModuleFunctionLoader;
}

export interface ProjectHookLoader {
  (declarationKey: string): ProjectHook | null;
}

export class Interpreter {
  #resolver: DomainResolver;
  readonly #loadProjectHook: ProjectHookLoader;
  readonly #tablesByEnvironment = new WeakMap<object, CompilationTables>();
  readonly #functions = new FunctionRegistry();
  readonly bindingTable = new BindingTable();
  readonly externalSources: ExternalSources;
  readonly diagnostics = new Diagnostics();
  readonly effectCalls: EffectCall[] = [];
  readonly renderedComponents = new Set<string>();
  #wholePropsSample: Sample | null = null;
  #restPropsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  #handlerEffects: EffectCollector | null = null;
  #currentFunction: HIRFunction | null = null;
  #blockVisits = 0;
  readonly #creationPaths = new WeakMap<SymbolicValue, CreationPath>();
  #loopDepth = 0;
  readonly #enteredLoopHeaders = new Map<BlockId, boolean>();
  #walkedCatches = new Set<BlockId>();
  #inlineDepth = 0;

  constructor(
    resolver: DomainResolver,
    loadModuleFunction: ModuleFunctionLoader,
    loadProjectHook: ProjectHookLoader,
    contextSetterFields: ContextSetterFields,
    actionsByStore: Map<string, StoreActions>,
  ) {
    this.#resolver = resolver;
    this.#functions.addModule(resolver, loadModuleFunction);
    this.#loadProjectHook = loadProjectHook;
    this.externalSources = new ExternalSources(contextSetterFields, actionsByStore);
  }

  #registerFunction(hirFunction: HIRFunction, isSnapshot = false): FunctionValue {
    return this.#functions.register(hirFunction, this.#resolver, isSnapshot);
  }

  #createClosure(hirFunction: HIRFunction): FunctionValue {
    const isInlined = this.#inlineDepth > 0;
    const closure = this.#registerFunction(hirFunction, isInlined);
    if (isInlined)
      this.#functions.setCapturedValues(
        closure.functionId,
        hirFunction.context.map((place): CapturedValue => [place, this.#read(place)]),
      );
    return closure;
  }

  #applyCapturedValues(functionId: number | null): () => void {
    const capturedValues = this.#functions.getCapturedValues(functionId);
    const liveValues = capturedValues.map(([place]): CapturedValue => [place, this.#read(place)]);
    for (const [place, value] of capturedValues) this.#write(place, value);
    return () => {
      for (const [place, value] of liveValues) this.#write(place, value);
    };
  }

  #getCurrentFunction(): HIRFunction {
    if (!this.#currentFunction) throw new Error("No function is being evaluated");
    return this.#currentFunction;
  }

  #createBinding(
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: InterpreterBindingOptions = {},
  ): Binding {
    return this.bindingTable.create(options.resolver ?? this.#resolver, name, kind, loc, options);
  }

  #readField(binding: Binding, path: string[], loc: SourceLocation): BindingValue {
    return this.bindingTable.readField(this.#resolver, binding, path, loc);
  }

  #getCompilationTables(): CompilationTables {
    const { env } = this.#getCurrentFunction();
    const compilationTables = this.#tablesByEnvironment.get(env) ?? {
      values: new Map(),
      propertyNames: new Map(),
      branchOperators: new Map(),
    };
    this.#tablesByEnvironment.set(env, compilationTables);
    return compilationTables;
  }

  #read(place: Place): SymbolicValue {
    return (
      this.#getCompilationTables().values.get(place.identifier.id) ??
      createUnknown("free-variable", place.loc)
    );
  }

  #write(place: Place, value: SymbolicValue): void {
    this.#getCompilationTables().values.set(place.identifier.id, value);
  }

  #getPropBinding(propName: string, localName: string, loc: SourceLocation): Binding {
    return this.bindingTable.getPropBinding(this.#resolver, propName, localName, loc);
  }

  #bindHookResult(place: Place, hook: HookResultValue): BindingValue {
    const binding = this.#createBinding(
      getIdentifierName(place) ?? hook.name,
      getHookBindingKind(hook.hookKind),
      getDeclarationLocation(place),
      { hookKind: hook.hookKind },
    );
    this.externalSources.bindHookResult(binding, hook, this.#resolver);
    return createBindingValue(binding);
  }

  #destructure(
    itemPlaces: Array<Place | null>,
    value: SymbolicValue,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    if (value.kind === "ArrayExpression" && value.spreads.length === 0)
      return itemPlaces.map((_itemPlace, index) => value.elements[index] ?? UNDEFINED_VALUE);
    if (value.kind !== "HookResult") return itemPlaces.map(() => null);
    const [statePlace] = itemPlaces;
    if (STATE_HOOKS.has(value.hookKind) && statePlace) {
      const [initialArgument] = value.argumentValues;
      const initial =
        initialArgument && initialArgument.kind !== "Function" ? initialArgument : null;
      const isAsserted = initial?.kind === "Unknown" && initial.reason === "cast";
      const binding = this.#createBinding(
        getIdentifierName(statePlace) ?? "state",
        "state",
        statePlace.loc,
        {
          hookKind: value.hookKind,
          initial,
          ...(isAsserted && { domain: ASSERTED_DOMAIN }),
        },
      );
      return [createBindingValue(binding), { kind: "Setter", binding }];
    }
    if (value.hookKind === "useReducer" && statePlace) {
      const [reducerArgument, initialArgument] = value.argumentValues;
      const binding = this.#createBinding(
        getIdentifierName(statePlace) ?? "state",
        "reducer",
        statePlace.loc,
        { hookKind: value.hookKind, initial: initialArgument ?? null },
      );
      return [
        createBindingValue(binding),
        {
          kind: "Dispatch",
          binding,
          reducer: reducerArgument
            ? this.#resolveModuleFunction(reducerArgument)
            : createUnknown("reducer", loc),
        },
      ];
    }
    return itemPlaces.map((place) => (place ? this.#bindHookResult(place, value) : null));
  }

  #evaluateDestructure(destructure: InstructionValueOfKind<"Destructure">): void {
    const { pattern } = destructure.lvalue;
    const value = this.#read(destructure.value);
    if (pattern.kind === "ArrayPattern") this.#destructureArray(pattern, value, destructure.loc);
    else this.#destructureObject(pattern, value);
  }

  #destructureArray(pattern: ArrayPattern, value: SymbolicValue, loc: SourceLocation): void {
    const itemPlaces = pattern.items.map((item) => (item.kind === "Identifier" ? item : null));
    const destructuredValues = this.#destructure(itemPlaces, value, loc);
    pattern.items.forEach((item, itemIndex) => {
      if (item.kind === "Hole") return;
      const itemPlace = getPlaceOrSpread(item);
      this.#write(
        itemPlace,
        destructuredValues[itemIndex] ?? createUnknown("destructure", itemPlace.loc),
      );
    });
  }

  #destructureObject(pattern: ObjectPattern, value: SymbolicValue): void {
    for (const property of pattern.properties) {
      if (property.kind === "Spread") {
        if (value.kind === "Props")
          this.#restPropsSample ??= this.#resolver.getRequiredSample(property.place.loc);
        this.#write(property.place, createUnknown("rest", property.place.loc));
        continue;
      }
      const key =
        property.key.kind === "string" || property.key.kind === "identifier"
          ? property.key.name
          : null;
      this.#write(
        property.place,
        key === null
          ? createUnknown("computed-key", property.place.loc)
          : this.#getDestructuredField(value, key, property.place),
      );
    }
  }

  #getDestructuredField(value: SymbolicValue, key: string, fieldPlace: Place): SymbolicValue {
    if (value.kind === "Props") {
      const localName = getIdentifierName(fieldPlace) ?? key;
      return createBindingValue(this.#getPropBinding(key, localName, fieldPlace.loc));
    }
    if (value.kind === "HookResult") {
      const hookCallBinding = this.#createBinding(
        `${value.name}()`,
        getHookBindingKind(value.hookKind),
        value.loc,
        { hookKind: value.hookKind, resolver: this.externalSources.getHookResolver(value) },
      );
      this.externalSources.bindHookResult(hookCallBinding, value, this.#resolver);
      return this.#readField(hookCallBinding, [key], fieldPlace.loc);
    }
    return this.#evaluatePropertyLoad(value, key, fieldPlace.loc);
  }

  #evaluatePropertyLoad(
    object: SymbolicValue,
    property: string,
    loc: SourceLocation,
  ): SymbolicValue {
    switch (object.kind) {
      case "Binding":
        return this.#readField(object.binding, [...object.path, property], loc);
      case "Props":
        return createBindingValue(this.#getPropBinding(property, property, loc));
      case "ObjectExpression":
        return (
          object.properties.findLast((candidate) => candidate.key === property)?.value ??
          (object.spreads.length > 0 ? createUnknown("spread", loc) : UNDEFINED_VALUE)
        );
      case "ArrayExpression":
        return property === "length" && object.spreads.length === 0
          ? { kind: "Primitive", value: object.elements.length }
          : createUnknown("member", loc);
      case "Global":
        return { kind: "Global", name: `${object.name}.${property}`, module: object.module };
      case "Conditional":
        if (isNullishValue(object.alternate))
          return this.#evaluatePropertyLoad(object.consequent, property, loc);
        if (isNullishValue(object.consequent))
          return this.#evaluatePropertyLoad(object.alternate, property, loc);
        return {
          ...object,
          consequent: this.#evaluatePropertyLoad(object.consequent, property, loc),
          alternate: this.#evaluatePropertyLoad(object.alternate, property, loc),
        };
      default:
        return createUnknown("member", loc);
    }
  }

  #getJsxTag(tag: InstructionValueOfKind<"JsxExpression">["tag"]): SymbolicValue {
    if (tag.kind === "BuiltinTag") return { kind: "Primitive", value: tag.name };
    return this.#read(tag);
  }

  #buildSuspense(element: JsxExpressionValue, terminalId: InstructionId): SymbolicValue {
    const fallback = element.props.find(
      (prop) => prop.kind === "JsxAttribute" && prop.name === "fallback",
    );
    if (!fallback) return element;
    const suspendedBinding = this.#createBinding("suspended", "suspense", element.loc, {
      domain: SUSPENDED_DOMAIN,
    });
    return {
      kind: "Conditional",
      test: createBindingValue(suspendedBinding),
      testKind: "truthy",
      consequent: { ...element, children: [fallback.value] },
      alternate: element,
      branch: this.#createBranch(terminalId, element.loc, "none"),
      guardKeys: [],
    };
  }

  #callFunction(
    callee: FunctionValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    const hirFunction = this.#functions.get(callee.functionId);
    if (!hirFunction || this.#inlineDepth >= MAX_INLINE_DEPTH) return createUnknown("call", loc);
    this.#inlineDepth++;
    try {
      return this.#evaluateFunction(hirFunction, argumentValues, walkState, callee.functionId);
    } finally {
      this.#inlineDepth--;
    }
  }

  #resolveModuleFunction(value: SymbolicValue): SymbolicValue {
    if (value.kind !== "Global") return value;
    const moduleFunction = this.#functions.loadModuleFunction(this.#resolver, value.name);
    return moduleFunction ? this.#registerFunction(moduleFunction) : value;
  }

  #warn(kind: WarningKind, message: string, loc: SourceLocation): void {
    this.diagnostics.warn(kind, message, loc, this.#resolver.fileName);
  }

  #trackMutations(instruction: Instruction, walkState: WalkState): void {
    if (isFunctionCreation(instruction.value)) return;
    const mutatedLiterals = new Set<SymbolicValue>();
    for (const effect of instruction.effects ?? []) {
      const mutatedPlace = getMutatedPlace(effect);
      if (!mutatedPlace) {
        this.#trackPossibleMutation(effect);
        continue;
      }
      const mutatedValue = this.#read(mutatedPlace);
      if (
        (mutatedValue.kind === "ArrayExpression" || mutatedValue.kind === "ObjectExpression") &&
        !mutatedLiterals.has(mutatedValue)
      ) {
        mutatedLiterals.add(
          this.#mutateLiteral(instruction, mutatedPlace, mutatedValue, walkState),
        );
        continue;
      }
      if (mutatedValue.kind !== "Binding") continue;
      const { binding } = mutatedValue;
      if (binding.kind === "prop")
        this.#warn(
          "prop-mutation",
          `mutates prop ${formatPlace(binding, mutatedValue.path)}`,
          mutatedPlace.loc,
        );
      else if (isStateBinding(binding) && this.#handlerEffects)
        this.#handlerEffects.addMutation(binding, mutatedPlace.loc);
      else if (isStateBinding(binding))
        this.#warn("render-mutation", `mutates ${binding.name} during render`, mutatedPlace.loc);
    }
  }

  #trackPossibleMutation(effect: AliasingEffect): void {
    const possiblyMutatedPlace = getConditionallyMutatedPlace(effect);
    if (!possiblyMutatedPlace || possiblyMutatedPlace.identifier.type.kind === "Primitive") return;
    const possiblyMutatedValue = this.#read(possiblyMutatedPlace);
    if (possiblyMutatedValue.kind === "Binding" && isStateBinding(possiblyMutatedValue.binding))
      this.#handlerEffects?.addPossibleMutation(possiblyMutatedValue.binding);
  }

  #mutateLiteral(
    instruction: Instruction,
    mutatedPlace: Place,
    literal: ArrayExpressionValue | ObjectExpressionValue,
    walkState: WalkState,
  ): SymbolicValue {
    const creationPath = this.#creationPaths.get(literal);
    const isOnCreationPath =
      creationPath !== undefined &&
      creationPath.guards === walkState.guards &&
      creationPath.loopDepth === this.#loopDepth;
    const mutatedLiteral = this.#getMutatedLiteral(
      instruction,
      mutatedPlace,
      literal,
      isOnCreationPath,
    );
    if (isOnCreationPath) this.#creationPaths.set(mutatedLiteral, creationPath);
    const { values } = this.#getCompilationTables();
    for (const [identifierId, value] of values)
      if (value === literal) values.set(identifierId, mutatedLiteral);
    return mutatedLiteral;
  }

  #getMutatedLiteral(
    instruction: Instruction,
    mutatedPlace: Place,
    literal: ArrayExpressionValue | ObjectExpressionValue,
    isOnCreationPath: boolean,
  ): SymbolicValue {
    const { value, loc } = instruction;
    const isPushIntoLiteral =
      literal.kind === "ArrayExpression" &&
      value.kind === "MethodCall" &&
      value.receiver.identifier.id === mutatedPlace.identifier.id &&
      this.#getCompilationTables().propertyNames.get(value.property.identifier.id) === "push";
    if (isPushIntoLiteral) return this.#pushIntoArray(literal, value, isOnCreationPath, loc);
    const isStoreIntoLiteral =
      literal.kind === "ObjectExpression" &&
      value.kind === "PropertyStore" &&
      value.object.identifier.id === mutatedPlace.identifier.id;
    if (isStoreIntoLiteral) return this.#storeIntoObject(literal, value, isOnCreationPath, loc);
    return createUnknown("mutation", loc);
  }

  #pushIntoArray(
    array: ArrayExpressionValue,
    push: InstructionValueOfKind<"MethodCall">,
    isOnCreationPath: boolean,
    loc: SourceLocation,
  ): ArrayExpressionValue {
    const pushedItems = push.args.flatMap((argument) =>
      argument.kind === "Identifier" ? [this.#read(argument)] : [],
    );
    const pushedSpreads = push.args.flatMap((argument) =>
      argument.kind === "Spread" ? [this.#read(argument.place)] : [],
    );
    if (isOnCreationPath)
      return {
        ...array,
        elements: [...array.elements, ...pushedItems],
        spreads: [...array.spreads, ...pushedSpreads],
      };
    const maybePushedItems = pushedItems.map((item): SymbolicValue => ({
      kind: "ArrayMap",
      array: createUnknown("mutation", loc),
      item,
      loc,
    }));
    return { ...array, spreads: [...array.spreads, ...pushedSpreads, ...maybePushedItems] };
  }

  #storeIntoObject(
    object: ObjectExpressionValue,
    store: InstructionValueOfKind<"PropertyStore">,
    isOnCreationPath: boolean,
    loc: SourceLocation,
  ): ObjectExpressionValue {
    const storedProperty = {
      key: String(store.property),
      value: isOnCreationPath ? this.#read(store.value) : createUnknown("mutation", loc),
    };
    return { ...object, properties: [...object.properties, storedProperty] };
  }

  #getSetterNextValue(
    setterArgument: SymbolicValue | undefined,
    previousValue: SymbolicValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    return setterArgument?.kind === "Function"
      ? this.#callFunction(setterArgument, [previousValue], loc, walkState)
      : (setterArgument ?? UNDEFINED_VALUE);
  }

  #applySetter(
    setter: SetterValue,
    setterArgument: SymbolicValue | undefined,
    walkState: WalkState,
  ): void {
    const previousValue = createBindingValue(setter.binding);
    const nextValue = this.#getSetterNextValue(
      setterArgument,
      previousValue,
      setter.binding.loc,
      walkState,
    );
    this.#handlerEffects?.recordSetterCall(setter.binding, nextValue, walkState);
  }

  #applyDispatch(
    dispatch: DispatchValue,
    action: SymbolicValue | undefined,
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const { reducer } = dispatch;
    const nextValue =
      reducer.kind === "Function"
        ? this.#callFunction(
            reducer,
            [createBindingValue(dispatch.binding), action ?? UNDEFINED_VALUE],
            loc,
            walkState,
          )
        : createUnknown("dispatch", loc);
    this.#handlerEffects?.recordSetterCall(dispatch.binding, nextValue, walkState);
  }

  #recordWholeProps(callSite: CallSite): void {
    const propsIndex = callSite.argumentValues.findIndex((argument) => argument.kind === "Props");
    const propsPlace = callSite.argumentPlaces[propsIndex];
    if (propsPlace) this.#wholePropsSample ??= this.#resolver.getSamples(propsPlace.loc)[0] ?? null;
  }

  #getCallTarget(callSite: CallSite): CallTarget {
    const [firstArgument] = callSite.argumentValues;
    if (this.#resolver.getReactExportName(callSite.loc) === "createPortal" && firstArgument)
      return { kind: "Portal", children: firstArgument };
    const hookKind = getHookKind(this.#getCurrentFunction().env, callSite.calleePlace.identifier);
    if (hookKind === "Custom") {
      const projectHook = this.#findProjectHook(callSite.calleePlace);
      if (projectHook)
        return this.#inlineDepth < MAX_INLINE_DEPTH
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
    return helperTakingCallbacks
      ? { kind: "ModuleFunction", hirFunction: helperTakingCallbacks }
      : { kind: "Value" };
  }

  #evaluateCall(callSite: CallSite, walkState: WalkState): SymbolicValue {
    this.#recordWholeProps(callSite);
    const target = this.#getCallTarget(callSite);
    switch (target.kind) {
      case "Portal":
        return target.children;
      case "ProjectHook":
        this.#functions.addModule(
          target.projectHook.resolver,
          target.projectHook.loadModuleFunction,
          target.projectHook.hirFunction,
        );
        return this.#inlineFunction(target.projectHook.hirFunction, callSite, walkState);
      case "Store":
        return this.#readStore(target.storeKey, target.storeActions, callSite, walkState);
      case "Hook":
        return this.#evaluateHookCall(target.hookKind, callSite, walkState);
      case "ModuleFunction":
        return this.#inlineFunction(target.hirFunction, callSite, walkState);
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
    return this.#callFunction(
      this.#registerFunction(hirFunction),
      callSite.argumentValues,
      callSite.loc,
      walkState,
    );
  }

  #callValue(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee } = callSite;
    const [firstArgument] = callSite.argumentValues;
    switch (callee.kind) {
      case "Function":
        return this.#callFunction(callee, callSite.argumentValues, callSite.loc, walkState);
      case "Conditional":
        return {
          ...callee,
          consequent: this.#evaluateCall({ ...callSite, callee: callee.consequent }, walkState),
          alternate: this.#evaluateCall({ ...callSite, callee: callee.alternate }, walkState),
        };
      case "Setter":
        this.#applySetter(callee, firstArgument, walkState);
        return UNDEFINED_VALUE;
      case "Dispatch":
        this.#applyDispatch(callee, firstArgument, callSite.loc, walkState);
        return UNDEFINED_VALUE;
      case "Binding":
        if (this.#handlerEffects && !this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc))
          this.#callBinding(callee, callSite.argumentValues, walkState);
        break;
      default:
        break;
    }
    for (const argument of callSite.argumentValues)
      this.#visitCallbackArgument(argument, walkState);
    if (this.#handlerEffects) return createUnknown("call", callSite.loc);
    if (!this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc))
      this.#addDeferredCallbacks(callSite.argumentValues, callSite.loc);
    if (this.#resolver.isReactElement(callSite.loc)) {
      this.diagnostics.bailOut(
        "unknown-call",
        "call returns JSX the analysis can't see into",
        callSite.loc,
      );
      return createUnknown("call", callSite.loc);
    }
    return this.#createCallResult(callSite);
  }

  #collectInputPlaces(
    value: SymbolicValue,
    inputPlaces: PlaceMap<true>,
    visitedFunctionIds = new Set<number>(),
  ): void {
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") inputPlaces.set(getValuePlace(part), true);
      if (part.kind !== "Function" || visitedFunctionIds.has(part.functionId)) return;
      visitedFunctionIds.add(part.functionId);
      for (const capturedPlace of this.#functions.get(part.functionId)?.context ?? [])
        this.#collectInputPlaces(this.#read(capturedPlace), inputPlaces, visitedFunctionIds);
    });
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

  #createCallResult(callSite: CallSite): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(callSite.loc);
    if (calleeText === null) return createUnknown("call", callSite.loc);
    const inputPlaces = new PlaceMap<true>();
    for (const argument of callSite.argumentValues) this.#collectInputPlaces(argument, inputPlaces);
    const receiverPlace = this.#getReceiverPlace(callSite.callee);
    const lengthLimit = this.#getLengthLimit(callSite, receiverPlace);
    const hasFiniteResult = this.#resolver.getDomain(callSite.loc).kind === "Cases";
    if (!lengthLimit && inputPlaces.size === 0 && !hasFiniteResult)
      return createUnknown("call", callSite.loc);
    if (receiverPlace) inputPlaces.set(receiverPlace, true);
    const argumentText = callSite.argumentValues.map(formatSymbolicValue).join(", ");
    return createBindingValue(
      this.#createBinding(`${calleeText}(${argumentText})`, "call", callSite.loc, {
        inputPlaces: inputPlaces.places(),
        lengthLimit,
      }),
    );
  }

  #visitCallbackArgument(argument: SymbolicValue, walkState: WalkState): void {
    if (!this.#handlerEffects) return;
    if (argument.kind === "ObjectExpression")
      for (const callback of getPassedCallbacks([argument]))
        this.#visitCallbackArgument(callback, walkState);
    const asyncWalkState = getAsyncWalkState(walkState);
    if (argument.kind === "Setter")
      this.#handlerEffects.recordSetterCall(
        argument.binding,
        createUnknown("callback-argument", GeneratedSource),
        asyncWalkState,
      );
    if (argument.kind === "Function")
      this.#callFunction(
        argument,
        [createUnknown("callback-argument", argument.loc)],
        argument.loc,
        asyncWalkState,
      );
  }

  #storeCallback(value: SymbolicValue, loc: SourceLocation, walkState: WalkState): void {
    if (value.kind === "Function") this.#passCallbacks([value], loc, walkState);
  }

  #passCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation, walkState: WalkState): void {
    if (!this.#handlerEffects) this.#addDeferredCallbacks(argumentValues, loc);
    else for (const argument of argumentValues) this.#visitCallbackArgument(argument, walkState);
  }

  #evaluateHookCall(hookKind: HookKind, callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee, argumentValues, argumentPlaces, loc } = callSite;
    const [firstArgument, secondArgument] = argumentValues;
    if (EFFECT_HOOKS.has(hookKind)) {
      if (firstArgument) this.#addEffectCall(hookKind, firstArgument, argumentPlaces[1], loc);
      return UNDEFINED_VALUE;
    }
    if (hookKind === "Custom") this.#addDeferredCallbacks(argumentValues, loc);
    if (hookKind === "useImperativeHandle" && secondArgument?.kind === "Function")
      this.#addDeferredCallbacks([this.#callFunction(secondArgument, [], loc, walkState)], loc);
    if (hookKind === "useMemo" && firstArgument?.kind === "Function")
      return this.#callFunction(firstArgument, [], loc, walkState);
    if (hookKind === "useCallback" && firstArgument) return firstArgument;
    const hookName = callee.kind === "Global" ? callee.name : hookKind;
    const hookModule = callee.kind === "Global" ? callee.module : null;
    const hookResult: HookResultValue = {
      kind: "HookResult",
      hookKind,
      name: hookName,
      module: hookModule,
      argumentValues,
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

  #addEffectCall(
    hookKind: HookKind,
    callback: SymbolicValue,
    dependenciesPlace: Place | undefined,
    loc: SourceLocation,
  ): void {
    this.effectCalls.push({
      hookKind,
      callback,
      callbackArguments: [],
      dependencies: dependenciesPlace ? this.#resolver.getSourceText(dependenciesPlace.loc) : null,
      loc,
    });
  }

  #addDeferredCallbacks(argumentValues: SymbolicValue[], loc: SourceLocation): void {
    for (const callback of getPassedCallbacks(argumentValues)) {
      if (callback.kind !== "Function") continue;
      const parameters = this.#functions.get(callback.functionId)?.params ?? [];
      this.effectCalls.push({
        hookKind: "Custom",
        callback,
        callbackArguments: parameters.map(() => createUnknown("callback-argument", callback.loc)),
        dependencies: null,
        loc,
      });
    }
  }

  #evaluateMethodCall(
    methodCall: InstructionValueOfKind<"MethodCall">,
    walkState: WalkState,
  ): SymbolicValue {
    const receiver = this.#read(methodCall.receiver);
    const methodName =
      this.#getCompilationTables().propertyNames.get(methodCall.property.identifier.id) ?? null;
    const argumentPlaces = methodCall.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.#read(place));
    const [callback] = argumentValues;
    const isIteratingLiteral =
      this.#handlerEffects !== null &&
      methodName !== null &&
      ITERATION_METHODS.has(methodName) &&
      receiver.kind === "ArrayExpression" &&
      callback?.kind === "Function";
    if (isIteratingLiteral) {
      this.#callForEachItem(callback, receiver, methodCall.loc, walkState);
      return createUnknown("call", methodCall.loc);
    }
    if (methodName === "map" && callback?.kind === "Function")
      return this.#evaluateArrayMap(receiver, callback, methodCall.loc, walkState);
    if (methodName !== null && PROMISE_METHODS.has(methodName)) {
      for (const argument of argumentValues)
        this.#visitCallbackArgument(argument, getAsyncWalkState(walkState));
      return createUnknown("async", methodCall.loc);
    }
    return this.#evaluateCall(
      {
        callee: this.#read(methodCall.property),
        calleePlace: methodCall.property,
        argumentValues,
        argumentPlaces,
        loc: methodCall.loc,
      },
      walkState,
    );
  }

  #callForEachItem(
    callback: FunctionValue,
    array: ArrayExpressionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const items = [...array.elements, ...array.spreads.map(() => createUnknown("item", loc))];
    for (const item of items) this.#callFunction(callback, [item], loc, walkState);
  }

  #evaluateArrayMap(
    array: SymbolicValue,
    callback: FunctionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    const [itemParameter] = this.#functions.get(callback.functionId)?.params ?? [];
    const itemPlace = itemParameter ? getPlaceOrSpread(itemParameter) : null;
    const item: SymbolicValue = itemPlace
      ? createBindingValue(
          this.#createBinding(getIdentifierName(itemPlace) ?? "item", "item", itemPlace.loc),
        )
      : createUnknown("item", loc);
    return {
      kind: "ArrayMap",
      array,
      item: this.#callFunction(callback, [item], loc, walkState),
      loc,
    };
  }

  #evaluateInstruction(instruction: Instruction, walkState: WalkState): void {
    const { value } = instruction;
    if (value.kind === "PropertyLoad")
      this.#getCompilationTables().propertyNames.set(
        instruction.lvalue.identifier.id,
        String(value.property),
      );
    this.#trackMutations(instruction, walkState);
    const instructionResult = this.#evaluateInstructionValue(instruction, walkState);
    if (value.kind === "ArrayExpression" || value.kind === "ObjectExpression")
      this.#creationPaths.set(instructionResult, {
        guards: walkState.guards,
        loopDepth: this.#loopDepth,
      });
    this.#write(instruction.lvalue, instructionResult);
  }

  #evaluateInstructionValue(instruction: Instruction, walkState: WalkState): SymbolicValue {
    const { value } = instruction;
    switch (value.kind) {
      case "Primitive":
        return { kind: "Primitive", value: value.value };
      case "JSXText":
        return { kind: "JSXText", value: value.value };
      case "LoadLocal":
      case "LoadContext":
        return this.#read(value.place);
      case "StoreLocal":
      case "StoreContext":
        return this.#evaluateStoreLocal(value);
      case "DeclareLocal":
      case "DeclareContext":
        this.#write(value.lvalue.place, UNDEFINED_VALUE);
        return UNDEFINED_VALUE;
      case "Destructure":
        this.#evaluateDestructure(value);
        return this.#read(value.value);
      case "LoadGlobal":
        return getGlobalValue(value);
      case "PropertyLoad":
        return this.#evaluatePropertyLoad(
          this.#read(value.object),
          String(value.property),
          value.loc,
        );
      case "ComputedLoad":
        return this.#evaluateComputedLoad(value);
      case "BinaryExpression":
        return foldBinary(value.operator, this.#read(value.left), this.#read(value.right));
      case "UnaryExpression":
        return foldUnary(value.operator, this.#read(value.value));
      case "TypeCastExpression":
        return this.#evaluateTypeCast(value);
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
        return this.#evaluateMethodCall(value, walkState);
      case "JsxExpression":
        return this.#evaluateJsxElement(value, instruction.id);
      case "JsxFragment":
        return { kind: "JsxFragment", children: value.children.map((child) => this.#read(child)) };
      case "Await":
        return createUnknown("async", value.loc);
      case "NewExpression":
        this.#passCallbacks(
          value.args.map((argument) => this.#read(getPlaceOrSpread(argument))),
          value.loc,
          walkState,
        );
        return createUnknown(value.kind, value.loc);
      case "PropertyStore":
      case "ComputedStore":
        this.#storeCallback(this.#read(value.value), value.loc, walkState);
        return createUnknown(value.kind, value.loc);
      case "TemplateLiteral":
      case "TaggedTemplateExpression":
      case "RegExpLiteral":
      case "MetaProperty":
      case "GetIterator":
      case "IteratorNext":
      case "NextPropertyOf":
      case "PropertyDelete":
      case "ComputedDelete":
      case "PostfixUpdateLocal":
      case "PrefixUpdateLocal":
      case "PostfixUpdateContext":
      case "PrefixUpdateContext":
      case "StoreGlobal":
      case "UnsupportedNode":
        return createUnknown(value.kind, value.loc);
      case "Debugger":
      case "StartMemoize":
      case "FinishMemoize":
        return UNDEFINED_VALUE;
      default:
        return assertExhaustive(value, "Unhandled instruction value");
    }
  }

  #evaluateStoreLocal(store: InstructionValueOfKind<"StoreLocal" | "StoreContext">): SymbolicValue {
    const storedValue = this.#read(store.value);
    const localValue =
      storedValue.kind === "HookResult" && getIdentifierName(store.lvalue.place) !== null
        ? this.#bindHookResult(store.lvalue.place, storedValue)
        : storedValue;
    this.#write(store.lvalue.place, localValue);
    return localValue;
  }

  #evaluateComputedLoad(computedLoad: InstructionValueOfKind<"ComputedLoad">): SymbolicValue {
    const propertyKey = this.#read(computedLoad.property);
    if (propertyKey.kind !== "Primitive" || isNullish(propertyKey.value))
      return createUnknown("computed-member", computedLoad.loc);
    return this.#evaluatePropertyLoad(
      this.#read(computedLoad.object),
      String(propertyKey.value),
      computedLoad.loc,
    );
  }

  #evaluateTypeCast(typeCast: InstructionValueOfKind<"TypeCastExpression">): SymbolicValue {
    const castValue = this.#read(typeCast.value);
    const isUntypedCast =
      castValue.kind === "Unknown" &&
      this.#resolver.getDomain(typeCast.value.loc).kind === "Unknown";
    return isUntypedCast ? createUnknown("cast", typeCast.value.loc) : castValue;
  }

  #evaluateObjectLiteral(objectLiteral: InstructionValueOfKind<"ObjectExpression">): SymbolicValue {
    return {
      kind: "ObjectExpression",
      properties: objectLiteral.properties.flatMap((property) =>
        property.kind === "ObjectProperty" &&
        (property.key.kind === "string" || property.key.kind === "identifier")
          ? [{ key: property.key.name, value: this.#read(property.place) }]
          : [],
      ),
      spreads: objectLiteral.properties.flatMap((property) =>
        property.kind === "Spread" ? [this.#read(property.place)] : [],
      ),
    };
  }

  #evaluateArrayLiteral(arrayLiteral: InstructionValueOfKind<"ArrayExpression">): SymbolicValue {
    return {
      kind: "ArrayExpression",
      elements: arrayLiteral.elements.flatMap((element): SymbolicValue[] => {
        if (element.kind === "Identifier") return [this.#read(element)];
        return element.kind === "Hole" ? [UNDEFINED_VALUE] : [];
      }),
      spreads: arrayLiteral.elements.flatMap((element) =>
        element.kind === "Spread" ? [this.#read(element.place)] : [],
      ),
    };
  }

  #evaluateCallExpression(
    call: InstructionValueOfKind<"CallExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const argumentPlaces = call.args.map(getPlaceOrSpread);
    return this.#evaluateCall(
      {
        callee: this.#read(call.callee),
        calleePlace: call.callee,
        argumentValues: argumentPlaces.map((place) => this.#read(place)),
        argumentPlaces,
        loc: call.loc,
      },
      walkState,
    );
  }

  #readJsxProps(element: InstructionValueOfKind<"JsxExpression">): Array<JsxProp | JsxSpreadProp> {
    return element.props.map((attribute): JsxProp | JsxSpreadProp =>
      attribute.kind === "JsxAttribute"
        ? {
            kind: "JsxAttribute",
            name: attribute.name,
            value: this.#read(attribute.place),
            handlerId: null,
          }
        : {
            kind: "JsxSpreadAttribute",
            value: this.#read(attribute.argument),
            handlerId: null,
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
    const jsxValue = buildJsx(
      this.#getJsxTag(element.tag),
      {
        declaration: isBuiltinTag ? null : this.#resolver.getDeclarationKey(element.tag.loc),
        isContext: !isBuiltinTag && this.#resolver.isContext(element.tag.loc),
        props,
        children: (element.children ?? []).map((child) => this.#read(child)),
        loc: element.loc,
      },
      this.renderedComponents,
    );
    const isSuspense = this.#resolver.getReactExportName(element.tag.loc) === "Suspense";
    return isSuspense && jsxValue.kind === "JsxExpression"
      ? this.#buildSuspense(jsxValue, instructionId)
      : jsxValue;
  }

  #resolvePhi(phi: Phi, outcome: Outcome, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Fallthrough": {
        const operand = outcome.from === null ? undefined : phi.operands.get(outcome.from);
        return operand ? this.#read(operand) : createUnknown("loop", phi.place.loc);
      }
      case "Split":
        return createConditional(outcome, guards, (arm, armGuards) =>
          this.#resolvePhi(phi, arm, armGuards),
        );
      case "Return":
        return createUnknown("unreachable", phi.place.loc);
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #continueAfter(
    outcome: Outcome,
    join: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
    hasResolvedPhis = false,
  ): Outcome {
    if (stops.has(join)) return outcome;
    const block = this.#getBlock(join);
    if (isFallthroughOnly(outcome, join)) {
      if (!hasResolvedPhis)
        for (const phi of block.phis)
          this.#write(phi.place, this.#resolvePhi(phi, outcome, walkState.guards));
      return this.#walk(join, stops, null, walkState, true);
    }
    const resumeAtJoin = (arm: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (arm.kind) {
        case "Return":
          return arm;
        case "Fallthrough":
          return arm.to === join
            ? this.#walk(join, stops, arm.from, { ...walkState, guards }, hasResolvedPhis)
            : arm;
        case "Split":
          return {
            ...arm,
            consequent: resumeAtJoin(arm.consequent, [...guards, getGuard(arm, true)]),
            alternate: resumeAtJoin(arm.alternate, [...guards, getGuard(arm, false)]),
          };
        default:
          return assertExhaustive(arm, "Unhandled outcome");
      }
    };
    return hasFallthrough(outcome, join) ? resumeAtJoin(outcome, walkState.guards) : outcome;
  }

  #createBranch(terminalId: InstructionId, loc: SourceLocation, probe: Branch["probe"]): Branch {
    return { terminalId, probe, loc, file: this.#resolver.fileName };
  }

  #getBlock(blockId: BlockId) {
    const block = this.#getCurrentFunction().body.blocks.get(blockId);
    if (!block) throw new Error(`Block bb${blockId} is missing`);
    return block;
  }

  #walkBranch(
    terminal: BranchTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const { test, consequent, alternate, fallthrough } = terminal;
    const operator = this.#getCompilationTables().branchOperators.get(fallthrough) ?? "ternary";
    const chainValue = this.#read(test);
    const shortCircuit = operator === "optional-chain-tail" ? getShortCircuit(chainValue) : null;
    const testValue = shortCircuit?.test ?? chainValue;
    const testKind: TestKind =
      shortCircuit?.testKind ??
      (operator === "??" || operator === "optional" || operator === "optional-chain-tail"
        ? "nullish"
        : "truthy");
    const branch = this.#createBranch(
      terminal.id,
      test.loc,
      this.#resolver.isExpression(test.loc) ? testKind : "none",
    );
    const testGuard = getTestExpression({ test: testValue, testKind });
    const walkArm = (armBlock: BlockId, isConsequent: boolean): Outcome => {
      const guards = [...walkState.guards, isConsequent ? testGuard : negate(testGuard)];
      return armBlock === fallthrough || stops.has(armBlock)
        ? { kind: "Fallthrough", from, to: armBlock }
        : this.#walk(
            armBlock,
            new Set([...stops, fallthrough]),
            from,
            { ...walkState, guards },
            false,
          );
    };
    const consequentOutcome = walkArm(consequent, true);
    const alternateOutcome = walkArm(alternate, false);
    const isSwapped = operator === "&&";
    const decidedOutcome =
      operator === "optional-chain-tail" && !shortCircuit
        ? true
        : getKnownOutcome(testValue, testKind);
    const branchOutcome: Outcome =
      decidedOutcome !== null
        ? decidedOutcome !== isSwapped
          ? consequentOutcome
          : alternateOutcome
        : {
            kind: "Split",
            test: testValue,
            testKind,
            branch,
            consequent: isSwapped ? alternateOutcome : consequentOutcome,
            alternate: isSwapped ? consequentOutcome : alternateOutcome,
          };
    return this.#continueAfter(branchOutcome, fallthrough, stops, walkState);
  }

  #walkSwitch(
    terminal: Extract<Terminal, { kind: "switch" }>,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    const caseStops = new Set([...stops, terminal.fallthrough]);
    const discriminant = this.#read(terminal.test);
    const buildCaseOutcome = (caseIndex: number): Outcome => {
      const switchCase = terminal.cases[caseIndex];
      if (!switchCase) return { kind: "Fallthrough", from, to: terminal.fallthrough };
      const caseOutcome: Outcome =
        switchCase.block === terminal.fallthrough
          ? { kind: "Fallthrough", from, to: terminal.fallthrough }
          : this.#walk(switchCase.block, caseStops, from, walkState, false);
      if (switchCase.test === null) return caseOutcome;
      const caseTest = foldBinary("===", discriminant, this.#read(switchCase.test));
      if (caseTest.kind === "Primitive")
        return caseTest.value ? caseOutcome : buildCaseOutcome(caseIndex + 1);
      return {
        kind: "Split",
        test: caseTest,
        testKind: "truthy",
        branch: this.#createBranch(terminal.id, switchCase.test.loc, "none"),
        consequent: caseOutcome,
        alternate: buildCaseOutcome(caseIndex + 1),
      };
    };
    return this.#continueAfter(buildCaseOutcome(0), terminal.fallthrough, stops, walkState);
  }

  #walkLoop(terminal: LoopTerminal, stops: ReadonlySet<BlockId>, walkState: WalkState): Outcome {
    const loopHeaders = getLoopHeaders(terminal);
    const loopBindings: Binding[] = [];
    for (const loopHeader of loopHeaders) {
      this.#enteredLoopHeaders.set(loopHeader, false);
      for (const phi of this.#getBlock(loopHeader).phis)
        this.#write(phi.place, this.#createLoopValue(phi, loopBindings));
    }
    const [loopEntry = terminal.fallthrough] = loopHeaders;
    this.#loopDepth++;
    let bodyOutcome: Outcome;
    try {
      bodyOutcome = this.#walk(
        loopEntry,
        new Set([...stops, terminal.fallthrough]),
        null,
        walkState,
        true,
      );
    } finally {
      this.#loopDepth--;
      for (const loopHeader of loopHeaders) this.#enteredLoopHeaders.delete(loopHeader);
    }
    for (const phi of this.#getBlock(terminal.fallthrough).phis)
      this.#write(phi.place, this.#createLoopValue(phi, loopBindings));
    this.#addLoopInputPlaces(loopBindings, loopEntry, terminal.fallthrough);
    const loopExit: Outcome = {
      kind: "Fallthrough",
      from: getLoopExit(terminal),
      to: terminal.fallthrough,
    };
    const exitOutcome = mapFallthroughs(bodyOutcome, (fallthrough) =>
      fallthrough.to === terminal.fallthrough || loopHeaders.includes(fallthrough.to)
        ? loopExit
        : fallthrough,
    );
    return this.#continueAfter(exitOutcome, terminal.fallthrough, stops, walkState, true);
  }

  #createLoopValue(phi: Phi, loopBindings: Binding[]): SymbolicValue {
    const variableName = getIdentifierName(phi.place);
    const declarationLoc = [phi.place, ...phi.operands.values()]
      .map(getDeclarationLocation)
      .find((candidate) => this.#resolver.getDeclaredDomain(candidate) !== null);
    const declaredDomain = declarationLoc && this.#resolver.getDeclaredDomain(declarationLoc);
    if (variableName === null || !declarationLoc || !declaredDomain)
      return createUnknown("loop", phi.place.loc);
    const binding = this.#createBinding(variableName, "loop", declarationLoc, {
      domain: declaredDomain,
    });
    if (!loopBindings.includes(binding)) loopBindings.push(binding);
    return createBindingValue(binding);
  }

  #addLoopInputPlaces(loopBindings: Binding[], loopEntry: BlockId, loopFallthrough: BlockId): void {
    if (loopBindings.length === 0) return;
    const inputPlaces = new PlaceMap<true>();
    const visitedBlocks = new Set([loopEntry, loopFallthrough]);
    const pendingBlocks = [loopEntry];
    for (const blockId of pendingBlocks) {
      const block = this.#getBlock(blockId);
      for (const instruction of block.instructions)
        this.#collectInputPlaces(this.#read(instruction.lvalue), inputPlaces);
      for (const successor of eachTerminalSuccessor(block.terminal)) {
        if (visitedBlocks.has(successor)) continue;
        visitedBlocks.add(successor);
        pendingBlocks.push(successor);
      }
    }
    const loopBindingIds = new Set(loopBindings.map((binding) => binding.id));
    const outsidePlaces = inputPlaces
      .places()
      .filter((place) => !loopBindingIds.has(place.bindingId));
    for (const binding of loopBindings)
      binding.inputPlaces = [...binding.inputPlaces, ...outsidePlaces];
  }

  #walk(
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    from: BlockId | null,
    walkState: WalkState,
    hasResolvedPhis: boolean,
  ): Outcome {
    let currentId = blockId;
    let previousId = from;
    let isPhiResolved = hasResolvedPhis;
    let currentWalkState = walkState;
    while (true) {
      if (++this.#blockVisits > MAX_BLOCK_VISITS) {
        this.diagnostics.bailOut("too-complex", "visits too many blocks", GeneratedSource);
        return { kind: "Return", value: createUnknown("too-complex", GeneratedSource) };
      }
      const isLoopHeader = this.#enteredLoopHeaders.has(currentId);
      if (isLoopHeader) {
        if (this.#enteredLoopHeaders.get(currentId))
          return { kind: "Fallthrough", from: previousId, to: currentId };
        this.#enteredLoopHeaders.set(currentId, true);
      }
      const block = this.#getBlock(currentId);
      if (!isPhiResolved && !isLoopHeader)
        this.#resolveBlockPhis(block, previousId, currentWalkState.guards);
      for (const instruction of block.instructions) {
        this.#evaluateInstruction(instruction, currentWalkState);
        if (instruction.value.kind === "Await")
          currentWalkState = getAsyncWalkState(currentWalkState);
      }
      const step = this.#walkTerminal(block.terminal, currentId, stops, currentWalkState);
      if (step.kind !== "Next") return step;
      previousId = currentId;
      currentId = step.block;
      isPhiResolved = false;
    }
  }

  #resolveBlockPhis(block: BasicBlock, from: BlockId | null, guards: SymbolicValue[]): void {
    for (const phi of block.phis)
      this.#write(
        phi.place,
        this.#resolvePhi(phi, { kind: "Fallthrough", from, to: block.id }, guards),
      );
  }

  #walkTerminal(
    terminal: Terminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): TerminalStep {
    switch (terminal.kind) {
      case "return":
        return { kind: "Return", value: this.#read(terminal.value) };
      case "throw":
      case "unreachable":
      case "unsupported":
        return { kind: "Return", value: createUnknown(terminal.kind, terminal.loc) };
      case "goto":
        return stops.has(terminal.block)
          ? { kind: "Fallthrough", from: blockId, to: terminal.block }
          : { kind: "Next", block: terminal.block };
      case "if":
      case "branch":
        return this.#walkBranch(terminal, blockId, stops, walkState);
      case "switch":
        return this.#walkSwitch(terminal, blockId, stops, walkState);
      case "ternary":
      case "logical":
      case "optional":
        return this.#walkValueBranch(terminal, blockId, stops, walkState);
      case "label":
      case "sequence":
      case "try":
      case "scope":
      case "pruned-scope":
        return { kind: "Next", block: terminal.block };
      case "maybe-throw":
        this.#walkCatchOnce(terminal.handler, blockId, stops, walkState);
        return { kind: "Next", block: terminal.continuation };
      case "for":
      case "for-of":
      case "for-in":
      case "while":
      case "do-while":
        return this.#walkLoop(terminal, stops, walkState);
      default:
        return assertExhaustive(terminal, "Unhandled terminal");
    }
  }

  #walkValueBranch(
    terminal: ValueBranchTerminal,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): Outcome {
    this.#getCompilationTables().branchOperators.set(
      terminal.fallthrough,
      getBranchOperator(terminal),
    );
    const testOutcome = this.#walk(
      terminal.test,
      new Set([...stops, terminal.fallthrough]),
      blockId,
      walkState,
      false,
    );
    return this.#continueAfter(testOutcome, terminal.fallthrough, stops, walkState);
  }

  #walkCatchOnce(
    catchBlock: BlockId | null,
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    walkState: WalkState,
  ): void {
    if (!this.#handlerEffects || catchBlock === null || this.#walkedCatches.has(catchBlock)) return;
    this.#walkedCatches.add(catchBlock);
    this.#walk(catchBlock, stops, blockId, walkState, false);
  }

  #getOutcomeValue(outcome: Outcome, loc: SourceLocation, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return createConditional(outcome, guards, (arm, armGuards) =>
          this.#getOutcomeValue(arm, loc, armGuards),
        );
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #readStore(
    storeKey: string,
    storeActions: StoreActions,
    callSite: CallSite,
    walkState: WalkState,
  ): SymbolicValue {
    const storeHookName = callSite.callee.kind === "Global" ? callSite.callee.name : "store";
    const storeBinding = this.externalSources.getStoreBinding(storeKey, storeActions, () =>
      this.#createBinding(`${storeHookName}()`, "hook", callSite.loc, {
        hookKind: "Custom",
        domain: { kind: "Opaque", typeText: storeHookName },
      }),
    );
    const [selector] = callSite.argumentValues;
    return selector?.kind === "Function"
      ? this.#callFunction(selector, [createBindingValue(storeBinding)], callSite.loc, walkState)
      : createBindingValue(storeBinding);
  }

  #findProjectHook(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#loadProjectHook(declarationKey) : null;
  }

  #evaluateFunction(
    hirFunction: HIRFunction,
    argumentValues: SymbolicValue[],
    walkState: WalkState,
    functionId: number | null = null,
  ): SymbolicValue {
    const previousFunction = this.#currentFunction;
    const previousResolver = this.#resolver;
    const previousWalkedCatches = this.#walkedCatches;
    this.#walkedCatches = new Set();
    this.#currentFunction = hirFunction;
    this.#resolver = this.#functions.getResolver(hirFunction) ?? previousResolver;
    const restoreLiveValues = this.#applyCapturedValues(functionId);
    try {
      hirFunction.params.forEach((parameter, parameterIndex) => {
        const parameterPlace = getPlaceOrSpread(parameter);
        this.#write(
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
      return this.#getOutcomeValue(
        this.#walk(hirFunction.body.entry, NO_STOPS, null, walkState, false),
        hirFunction.loc,
        walkState.guards,
      );
    } finally {
      restoreLiveValues();
      this.#currentFunction = previousFunction;
      this.#resolver = previousResolver;
      this.#walkedCatches = previousWalkedCatches;
    }
  }

  get wholePropsSample(): Sample | null {
    return this.#wholePropsSample ?? this.#restPropsSample;
  }

  evaluateComponent(hirFunction: HIRFunction): SymbolicValue {
    this.#blockVisits = 0;
    return this.#evaluateFunction(hirFunction, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  #callBinding(callee: BindingValue, argumentValues: SymbolicValue[], walkState: WalkState): void {
    const { binding, path } = callee;
    if (binding.kind === "prop") this.#handlerEffects?.addDelegate(formatPlace(binding, path));
    const memberName = path.length === 1 ? path[0] : undefined;
    const setterField = memberName && this.externalSources.getSetterField(binding, memberName);
    if (setterField)
      return this.#setContextField(binding, setterField, argumentValues[0], walkState);
    const assignments =
      memberName && this.externalSources.getActionAssignments(binding, memberName);
    if (assignments)
      return this.#handlerEffects?.recordSetterCall(
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
    const previousValue: SymbolicValue = { kind: "Binding", binding, path: [field] };
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
      walkState.guards,
      true,
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
          walkState.guards,
          true,
        );
  }

  #collectRenderedHandlers(renderedValue: SymbolicValue, visitedFunctionIds: Set<number>): void {
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
  ): void {
    if (callback.kind === "Setter")
      this.#handlerEffects?.recordSetterCall(callback.binding, EVENT_ARGUMENT, ROOT_WALK_STATE);
    if (callback.kind === "Binding") this.#callBinding(callback, argumentValues, ROOT_WALK_STATE);
    if (callback.kind !== "Function" || visitedFunctionIds.has(callback.functionId)) return;
    visitedFunctionIds.add(callback.functionId);
    const hirFunction = this.#functions.get(callback.functionId);
    if (hirFunction)
      this.#collectRenderedHandlers(
        this.#evaluateFunction(hirFunction, argumentValues, ROOT_WALK_STATE, callback.functionId),
        visitedFunctionIds,
      );
  }

  collectEffects(callback: SymbolicValue, argumentValues: SymbolicValue[]): CollectedEffects {
    const previousEffects = this.#handlerEffects;
    const previousBlockVisits = this.#blockVisits;
    const handlerEffects = new EffectCollector((kind, message, loc) =>
      this.#warn(kind, message, loc),
    );
    this.#handlerEffects = handlerEffects;
    this.#blockVisits = 0;
    try {
      const callbacks =
        callback.kind === "ObjectExpression"
          ? callback.properties.map((property) => property.value)
          : [callback];
      for (const eachCallback of callbacks)
        this.#runCallback(eachCallback, argumentValues, new Set());
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
      this.#blockVisits = previousBlockVisits;
    }
  }
}
