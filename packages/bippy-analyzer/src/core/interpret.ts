import type {
  ArrayPattern,
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  ObjectPattern,
  ObjectPropertyKey,
  Place,
  SpreadPattern,
  SourceLocation,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource, getHookKind } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import type { AliasingEffect } from "../react-compiler/Inference/AliasingEffects";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { SourceFileResolver } from "./source-file-resolver";
import { ControlFlowWalker } from "./control-flow-walker";
import type { BranchOperator } from "./control-flow-walker";
import { ROOT_WALK_STATE, getAsyncWalkState } from "./walk-state";
import type { WalkState } from "./walk-state";
import type {
  ArrayExpressionValue,
  Binding,
  Claim,
  BindingKind,
  BindingPlace,
  BindingValue,
  ContextSetterFields,
  Branch,
  DispatchValue,
  Domain,
  FunctionValue,
  GlobalValue,
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
  WarningKind,
} from "./types";
import { formatPlace, formatSymbolicValue } from "./format";
import {
  CLAIM_FUNCTIONS,
  createCastClaim,
  createNonNullClaim,
  describeCondition,
  hasNullishCase,
} from "./claim-sites";
import { hasUnknownPart } from "./constraints";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { EVENT_ARGUMENT, isHandlerProp } from "./collect-handlers";
import { PlaceMap } from "./utils/place-map";
import { getBindingPlace } from "./utils/get-binding-place";
import { getValuePlace } from "./utils/get-value-place";
import { isExternalSource } from "./utils/is-external-source";
import { isNullish } from "./utils/is-nullish";
import { isNullishValue } from "./utils/is-nullish-value";
import { isStateBinding } from "./utils/is-state-binding";
import { getTestExpression } from "./utils/get-test-expression";
import { negate } from "./utils/negate";
import {
  UNDEFINED_VALUE,
  createBindingValue,
  createUnknown,
  foldBinary,
  foldUnary,
  getContainedValues,
  getPassedCallbacks,
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
import { NO_STOPS } from "./control-flow";
import { getDeclarationLocation } from "./utils/get-declaration-location";
import { getIdentifierName } from "./utils/get-identifier-name";
import { getConditionallyMutatedPlace } from "./utils/get-conditionally-mutated-place";
import { getMutatedPlace } from "./utils/get-mutated-place";
import { getPlaceOrSpread } from "./utils/get-place-or-spread";
import { getWrittenContextPlaces } from "./utils/get-written-context-places";
import { isFunctionCreation } from "./utils/is-function-creation";

type InstructionValueOfKind<Kind extends InstructionValue["kind"]> = Extract<
  InstructionValue,
  { kind: Kind }
>;

interface InterpreterBindingOptions extends BindingOptions {
  resolver?: SourceFileResolver;
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
  aliasSources: Map<IdentifierId, Place>;
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
  resolver: SourceFileResolver;
  loadModuleFunction: ModuleFunctionLoader;
}

export interface ProjectHookLoader {
  (declarationKey: string): ProjectHook | null;
}

const MAX_INLINE_DEPTH = 4;
const MAX_ALIAS_CHAIN_LENGTH = 32;
const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic", "useActionState"]);
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const SHORTENING_METHODS = new Set(["filter", "slice"]);
const LENGTH_PRESERVING_METHODS = new Set(["toReversed", "toSorted", "with"]);
const RENDERED_ITERATION_METHODS = new Set(["map", "flatMap"]);
const ITERATION_METHODS = new Set(["forEach", "map", "filter", "some", "every", "find", "flatMap"]);

const ASSERTED_DOMAIN: Domain = { kind: "Unknown", reason: "cast" };
const SUSPENDED_DOMAIN: Domain = {
  kind: "Cases",
  cases: [
    { kind: "Literal", value: true },
    { kind: "Literal", value: false },
  ],
  origin: "type",
};

const isLiteralDomain = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.every((value) => value.kind === "Literal");

const createFieldUpdate = (
  binding: Binding,
  properties: ObjectExpressionValue["properties"],
): ObjectExpressionValue => ({
  kind: "ObjectExpression",
  properties,
  spreads: [createBindingValue(binding)],
});

const isReassignedPlace = (instruction: Instruction, place: Place): boolean =>
  instruction.value.kind === "StoreContext" &&
  instruction.value.lvalue.place.identifier.id === place.identifier.id;

const isOwnedValue = (value: SymbolicValue): value is BindingValue =>
  value.kind === "Binding" && (value.binding.kind === "prop" || isStateBinding(value.binding));

const getOwnedValues = (value: SymbolicValue): BindingValue[] => {
  if (value.kind === "Conditional")
    return [...getOwnedValues(value.consequent), ...getOwnedValues(value.alternate)];
  return isOwnedValue(value) ? [value] : [];
};

const getCopiedOwnedValue = (array: ArrayExpressionValue): BindingValue | null => {
  const [copiedValue] = array.spreads;
  return array.elements.length === 0 &&
    array.spreads.length === 1 &&
    copiedValue &&
    isOwnedValue(copiedValue)
    ? copiedValue
    : null;
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

export class Interpreter {
  #resolver: SourceFileResolver;
  readonly #loadProjectHook: ProjectHookLoader;
  readonly #tablesByEnvironment = new WeakMap<object, CompilationTables>();
  readonly #functions = new FunctionRegistry();
  readonly walker = new ControlFlowWalker(this);
  readonly bindingTable = new BindingTable();
  readonly externalSources: ExternalSources;
  readonly diagnostics = new Diagnostics();
  readonly effectCalls: EffectCall[] = [];
  readonly decidedBranchOutcomes = new Map<string, boolean[]>();
  readonly #renderPhaseEffects = new EffectCollector((kind, message, loc) =>
    this.#warn(kind, message, loc),
  );
  readonly renderedComponents = new Set<string>();
  readonly #claims: Claim[] = [];
  #wholePropsSample: Sample | null = null;
  #restPropsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  #handlerEffects: EffectCollector | null = null;
  #currentFunction: HIRFunction | null = null;
  readonly #creationPaths = new WeakMap<SymbolicValue, CreationPath>();
  #inlineDepth = 0;

  constructor(
    resolver: SourceFileResolver,
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

  get resolver(): SourceFileResolver {
    return this.#resolver;
  }

  get handlerEffects(): EffectCollector | null {
    return this.#handlerEffects;
  }

  get claims(): Claim[] {
    return this.#claims;
  }

  get wholePropsSample(): Sample | null {
    return this.#wholePropsSample ?? this.#restPropsSample;
  }

  evaluateComponent(hirFunction: HIRFunction): SymbolicValue {
    this.walker.blockVisits = 0;
    return this.#evaluateFunction(hirFunction, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  finishRenderPhaseEffects(): CollectedEffects {
    return this.#renderPhaseEffects.finish();
  }

  collectEffects(callback: SymbolicValue, argumentValues: SymbolicValue[]): CollectedEffects {
    const previousEffects = this.#handlerEffects;
    const previousBlockVisits = this.walker.blockVisits;
    const handlerEffects = new EffectCollector((kind, message, loc) =>
      this.#warn(kind, message, loc),
    );
    this.#handlerEffects = handlerEffects;
    this.walker.blockVisits = 0;
    try {
      const callbacks = getContainedValues(callback);
      for (const handlerCallback of callbacks)
        this.#runCallback(handlerCallback, argumentValues, new Set());
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

  #getUpdateCollector(): EffectCollector {
    return this.#handlerEffects ?? this.#renderPhaseEffects;
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
        hirFunction.context.map((place): CapturedValue => [place, this.read(place)]),
      );
    return closure;
  }

  #applyCapturedValues(functionId: number | null): () => void {
    const capturedValues = this.#functions.getCapturedValues(functionId);
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
    return this.bindingTable.createBinding(
      options.resolver ?? this.#resolver,
      name,
      kind,
      loc,
      options,
    );
  }

  #readField(binding: Binding, path: string[], loc: SourceLocation): BindingValue {
    return this.bindingTable.readField(this.#resolver, binding, path, loc);
  }

  getCompilationTables(): CompilationTables {
    const { env } = this.getCurrentFunction();
    const compilationTables = this.#tablesByEnvironment.get(env) ?? {
      values: new Map(),
      propertyNames: new Map(),
      branchOperators: new Map(),
      aliasSources: new Map(),
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

  #getPropBinding(propName: string, localName: string, loc: SourceLocation): Binding {
    return this.bindingTable.getPropBinding(this.#resolver, propName, localName, loc);
  }

  #bindHookResult(place: Place, hook: HookResultValue): BindingValue {
    const binding = this.createBinding(
      getIdentifierName(place) ?? hook.name,
      getHookBindingKind(hook.hookKind),
      getDeclarationLocation(place),
      { hookKind: hook.hookKind },
    );
    this.externalSources.bindHookResult(binding, hook, this.#resolver);
    return createBindingValue(binding);
  }

  #getDestructuredValues(
    itemPlaces: Array<Place | null>,
    value: SymbolicValue,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    if (value.kind === "ArrayExpression" && value.spreads.length === 0)
      return itemPlaces.map((_itemPlace, index) => value.elements[index] ?? UNDEFINED_VALUE);
    if (value.kind !== "HookResult") return itemPlaces.map(() => null);
    const [statePlace] = itemPlaces;
    if (STATE_HOOKS.has(value.hookKind) && statePlace)
      return this.#destructureState(value, statePlace);
    if (value.hookKind === "useReducer" && statePlace)
      return this.#destructureReducer(value, statePlace, loc);
    return itemPlaces.map((place) => (place ? this.#bindHookResult(place, value) : null));
  }

  #destructureState(hook: HookResultValue, statePlace: Place): SymbolicValue[] {
    const [initialArgument] = hook.argumentValues;
    const initial = initialArgument && initialArgument.kind !== "Function" ? initialArgument : null;
    const isAsserted = initial?.kind === "Unknown" && initial.reason === "cast";
    const binding = this.createBinding(
      getIdentifierName(statePlace) ?? "state",
      "state",
      statePlace.loc,
      {
        hookKind: hook.hookKind,
        initial,
        ...(isAsserted && { domain: ASSERTED_DOMAIN }),
      },
    );
    return [createBindingValue(binding), { kind: "Setter", binding }];
  }

  #destructureReducer(
    hook: HookResultValue,
    statePlace: Place,
    loc: SourceLocation,
  ): SymbolicValue[] {
    const [reducerArgument, initialArgument] = hook.argumentValues;
    const binding = this.createBinding(
      getIdentifierName(statePlace) ?? "state",
      "reducer",
      statePlace.loc,
      { hookKind: hook.hookKind, initial: initialArgument ?? null },
    );
    const reducer = reducerArgument
      ? this.#resolveModuleFunction(reducerArgument)
      : createUnknown("reducer", loc);
    return [createBindingValue(binding), { kind: "Dispatch", binding, reducer }];
  }

  #evaluateDestructure(destructure: InstructionValueOfKind<"Destructure">): void {
    const { pattern } = destructure.lvalue;
    const value = this.read(destructure.value);
    if (pattern.kind === "ArrayPattern") this.#destructureArray(pattern, value, destructure.loc);
    else this.#destructureObject(pattern, value);
  }

  #destructureArray(pattern: ArrayPattern, value: SymbolicValue, loc: SourceLocation): void {
    const itemPlaces = pattern.items.map((item) => (item.kind === "Identifier" ? item : null));
    const destructuredValues = this.#getDestructuredValues(itemPlaces, value, loc);
    pattern.items.forEach((item, itemIndex) => {
      if (item.kind === "Hole") return;
      const itemPlace = getPlaceOrSpread(item);
      this.write(
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
        this.write(property.place, createUnknown("rest", property.place.loc));
        continue;
      }
      const key =
        property.key.kind === "string" || property.key.kind === "identifier"
          ? property.key.name
          : null;
      this.write(
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
      const hookCallBinding = this.createBinding(
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
      if (mutatedPlace && isReassignedPlace(instruction, mutatedPlace)) continue;
      if (!mutatedPlace) {
        this.#trackPossibleMutation(effect);
        continue;
      }
      const mutatedValue = this.read(mutatedPlace);
      if (
        (mutatedValue.kind === "ArrayExpression" || mutatedValue.kind === "ObjectExpression") &&
        !mutatedLiterals.has(mutatedValue)
      ) {
        mutatedLiterals.add(
          this.#mutateLiteral(instruction, mutatedPlace, mutatedValue, walkState),
        );
        continue;
      }
      if (mutatedValue.kind === "Global") this.#trackGlobalMutation(mutatedValue, mutatedPlace.loc);
      const ownedValues = getOwnedValues(mutatedValue);
      const aliasedValue =
        ownedValues.length > 0 ? null : this.#findAliasedOwnedValue(mutatedPlace);
      for (const ownedValue of aliasedValue ? [aliasedValue] : ownedValues)
        this.#trackOwnedMutation(ownedValue, mutatedPlace.loc);
    }
  }

  #trackOwnedMutation(ownedValue: BindingValue, loc: SourceLocation): void {
    const { binding } = ownedValue;
    if (binding.kind === "prop")
      this.#warn("prop-mutation", `mutates prop ${formatPlace(binding, ownedValue.path)}`, loc);
    else if (this.#handlerEffects) this.#handlerEffects.addMutation(binding, loc);
    else this.#warn("render-mutation", `mutates ${binding.name} during render`, loc);
  }

  #recordAliasSources(instruction: Instruction): void {
    const { aliasSources } = this.getCompilationTables();
    for (const effect of instruction.effects ?? [])
      if (effect.kind === "Assign" || effect.kind === "Alias" || effect.kind === "CreateFrom")
        aliasSources.set(effect.into.identifier.id, effect.from);
  }

  #findAliasedOwnedValue(place: Place): BindingValue | null {
    const { aliasSources } = this.getCompilationTables();
    let source = aliasSources.get(place.identifier.id);
    for (let chainLength = 0; source && chainLength < MAX_ALIAS_CHAIN_LENGTH; chainLength++) {
      const sourceValue = this.read(source);
      if (isOwnedValue(sourceValue)) return sourceValue;
      if (sourceValue.kind === "ArrayExpression") return getCopiedOwnedValue(sourceValue);
      source = aliasSources.get(source.identifier.id);
    }
    return null;
  }

  #trackGlobalMutation(mutatedGlobal: GlobalValue, loc: SourceLocation): void {
    if (!this.#handlerEffects) return;
    for (const binding of this.bindingTable.bindings)
      if (isStateBinding(binding) && this.#isInitializedFrom(binding, mutatedGlobal))
        this.#handlerEffects.addMutation(binding, loc);
  }

  #isInitializedFrom(binding: Binding, mutatedGlobal: GlobalValue): boolean {
    const { initial } = binding;
    return (
      initial?.kind === "Global" &&
      initial.module === mutatedGlobal.module &&
      (mutatedGlobal.name === initial.name || mutatedGlobal.name.startsWith(`${initial.name}.`)) &&
      this.bindingTable.isDeclaredIn(binding, this.#resolver.fileName)
    );
  }

  #trackPossibleMutation(effect: AliasingEffect): void {
    const possiblyMutatedPlace = getConditionallyMutatedPlace(effect);
    if (!possiblyMutatedPlace || possiblyMutatedPlace.identifier.type.kind === "Primitive") return;
    const possiblyMutatedValue = this.read(possiblyMutatedPlace);
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
      creationPath.loopDepth === this.walker.loopDepth;
    const mutatedLiteral = this.#getMutatedLiteral(
      instruction,
      mutatedPlace,
      literal,
      isOnCreationPath,
    );
    if (isOnCreationPath) this.#creationPaths.set(mutatedLiteral, creationPath);
    const { values } = this.getCompilationTables();
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
      this.getCompilationTables().propertyNames.get(value.property.identifier.id) === "push";
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
      argument.kind === "Identifier" ? [this.read(argument)] : [],
    );
    const pushedSpreads = push.args.flatMap((argument) =>
      argument.kind === "Spread" ? [this.read(argument.place)] : [],
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
      value: isOnCreationPath ? this.read(store.value) : createUnknown("mutation", loc),
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
    this.#getUpdateCollector().recordSetterCall(setter.binding, nextValue, walkState);
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
    this.#getUpdateCollector().recordSetterCall(dispatch.binding, nextValue, walkState);
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
    const hookKind = getHookKind(this.getCurrentFunction().env, callSite.calleePlace.identifier);
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
      ? this.#callFunction(selector, [createBindingValue(storeBinding)], callSite.loc, walkState)
      : createBindingValue(storeBinding);
  }

  #findProjectHook(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#loadProjectHook(declarationKey) : null;
  }

  #evaluateCall(callSite: CallSite, walkState: WalkState): SymbolicValue {
    this.#recordWholeProps(callSite);
    const target = this.#getCallTarget(callSite);
    this.#claimInvariant(callSite, target, walkState);
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
      default:
        return this.#callOpaqueValue(callSite, walkState);
    }
  }

  #callOpaqueValue(callSite: CallSite, walkState: WalkState): SymbolicValue {
    const { callee, argumentValues, loc } = callSite;
    const isMutatingCall = !this.#resolver.isNonMutatingMethod(callSite.calleePlace.loc);
    if (this.#handlerEffects && isMutatingCall && callee.kind === "Binding")
      this.#callBinding(callee, argumentValues, walkState);
    if (this.#handlerEffects || isMutatingCall) this.#passCallbacks(argumentValues, loc, walkState);
    if (this.#handlerEffects) return createUnknown("call", loc);
    this.#forgetCallbackWrites(argumentValues, loc);
    if (this.#resolver.isReactElement(loc)) {
      this.diagnostics.bailOut("unknown-call", "call returns JSX the analysis can't see into", loc);
      return createUnknown("call", loc);
    }
    return this.#createCallResult(callSite);
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

  #createCallResult(callSite: CallSite): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(callSite.loc);
    if (calleeText === null) return createUnknown("call", callSite.loc);
    const inputPlaces = new PlaceMap<true>();
    for (const argument of callSite.argumentValues) this.collectInputPlaces(argument, inputPlaces);
    const receiverPlace = this.#getReceiverPlace(callSite.callee);
    const lengthLimit = this.#getLengthLimit(callSite, receiverPlace);
    const hasFiniteResult = this.#resolver.getDomain(callSite.loc).kind === "Cases";
    if (!lengthLimit && inputPlaces.size === 0 && !hasFiniteResult)
      return createUnknown("call", callSite.loc);
    if (receiverPlace) inputPlaces.set(receiverPlace, true);
    const argumentText = callSite.argumentValues.map(formatSymbolicValue).join(", ");
    return createBindingValue(
      this.createBinding(`${calleeText}(${argumentText})`, "call", callSite.loc, {
        inputPlaces: inputPlaces.places(),
        lengthLimit,
      }),
    );
  }

  #visitPromiseCallbacks(
    methodName: string,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const asyncWalkState = getAsyncWalkState(walkState);
    const isRejected = createUnknown("rejected", loc);
    const guardsByArgument =
      methodName === "then"
        ? [negate(isRejected), isRejected]
        : methodName === "catch"
          ? [isRejected]
          : [];
    argumentValues.forEach((argument, argumentIndex) => {
      const guard = guardsByArgument[argumentIndex];
      this.#visitCallbackArgument(
        argument,
        guard ? { ...asyncWalkState, guards: [...asyncWalkState.guards, guard] } : asyncWalkState,
      );
    });
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
        this.#getUnknownArguments(argument),
        argument.loc,
        asyncWalkState,
      );
  }

  #getUnknownArguments(callback: FunctionValue): SymbolicValue[] {
    const parameterCount = this.#functions.get(callback.functionId)?.params.length ?? 1;
    return Array.from({ length: Math.max(parameterCount, 1) }, () =>
      createUnknown("callback-argument", callback.loc),
    );
  }

  #passStoredCallback(
    store: InstructionValueOfKind<"PropertyStore" | "ComputedStore">,
    walkState: WalkState,
  ): void {
    const storedValue = this.read(store.value);
    if (storedValue.kind === "Function") this.#passCallbacks([storedValue], store.loc, walkState);
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
    const receiver = this.read(methodCall.receiver);
    const methodName =
      this.getCompilationTables().propertyNames.get(methodCall.property.identifier.id) ?? "";
    const argumentPlaces = methodCall.args.map(getPlaceOrSpread);
    const argumentValues = argumentPlaces.map((place) => this.read(place));
    const [callback] = argumentValues;
    if (ITERATION_METHODS.has(methodName))
      this.#visitItemCallback(methodName, callback, methodCall, walkState);
    const isIteratingLiteral =
      this.#handlerEffects !== null &&
      ITERATION_METHODS.has(methodName) &&
      receiver.kind === "ArrayExpression" &&
      callback?.kind === "Function";
    if (isIteratingLiteral) {
      this.#callForEachItem(callback, receiver, methodCall.loc, walkState);
      return createUnknown("call", methodCall.loc);
    }
    if (RENDERED_ITERATION_METHODS.has(methodName) && callback?.kind === "Function")
      return this.#evaluateArrayMap(receiver, callback, methodCall.loc, walkState);
    if (PROMISE_METHODS.has(methodName)) {
      this.#visitPromiseCallbacks(methodName, argumentValues, methodCall.loc, walkState);
      return createUnknown("async", methodCall.loc);
    }
    return this.#evaluateCall(
      {
        callee: this.read(methodCall.property),
        calleePlace: methodCall.property,
        argumentValues,
        argumentPlaces,
        loc: methodCall.loc,
      },
      walkState,
    );
  }

  #visitItemCallback(
    methodName: string,
    callback: SymbolicValue | undefined,
    methodCall: InstructionValueOfKind<"MethodCall">,
    walkState: WalkState,
  ): void {
    if (callback?.kind !== "Function") return;
    const [itemParameter] = this.#functions.get(callback.functionId)?.params ?? [];
    if (itemParameter?.kind === "Identifier")
      this.getCompilationTables().aliasSources.set(
        itemParameter.identifier.id,
        methodCall.receiver,
      );
    if (!this.#handlerEffects && methodName === "forEach")
      this.#callFunction(callback, this.#getUnknownArguments(callback), methodCall.loc, walkState);
  }

  #callForEachItem(
    callback: FunctionValue,
    array: ArrayExpressionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const items = [...array.elements, ...array.spreads.map(() => createUnknown("item", loc))];
    items.forEach((item, itemIndex) =>
      this.#callFunction(
        callback,
        [item, { kind: "Primitive", value: itemIndex }, array],
        loc,
        walkState,
      ),
    );
  }

  #evaluateArrayMap(
    array: SymbolicValue,
    callback: FunctionValue,
    loc: SourceLocation,
    walkState: WalkState,
  ): SymbolicValue {
    const [itemParameter, indexParameter] = this.#functions.get(callback.functionId)?.params ?? [];
    const item = this.#createItemValue(itemParameter, "item", loc);
    const index = this.#createItemValue(indexParameter, "index", loc);
    return {
      kind: "ArrayMap",
      array,
      item: this.#callFunction(callback, [item, index, array], loc, walkState),
      loc,
    };
  }

  #createItemValue(
    parameter: Place | SpreadPattern | undefined,
    fallbackName: string,
    loc: SourceLocation,
  ): SymbolicValue {
    const place = parameter ? getPlaceOrSpread(parameter) : null;
    return place
      ? createBindingValue(
          this.createBinding(getIdentifierName(place) ?? fallbackName, "item", place.loc),
        )
      : createUnknown(fallbackName, loc);
  }

  evaluateInstruction(instruction: Instruction, walkState: WalkState): void {
    const { value } = instruction;
    if (value.kind === "PropertyLoad")
      this.getCompilationTables().propertyNames.set(
        instruction.lvalue.identifier.id,
        String(value.property),
      );
    this.#recordAliasSources(instruction);
    this.#trackMutations(instruction, walkState);
    const instructionResult = this.#evaluateInstructionValue(instruction, walkState);
    if (value.kind === "ArrayExpression" || value.kind === "ObjectExpression")
      this.#creationPaths.set(instructionResult, {
        guards: walkState.guards,
        loopDepth: this.walker.loopDepth,
      });
    this.write(instruction.lvalue, instructionResult);
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
        return this.read(value.place);
      case "StoreLocal":
      case "StoreContext":
        return this.#evaluateStoreLocal(value);
      case "DeclareLocal":
      case "DeclareContext":
        this.write(value.lvalue.place, UNDEFINED_VALUE);
        return UNDEFINED_VALUE;
      case "Destructure":
        this.#evaluateDestructure(value);
        return this.read(value.value);
      case "LoadGlobal":
        return getGlobalValue(value);
      case "PropertyLoad":
        return this.#evaluatePropertyLoad(
          this.read(value.object),
          String(value.property),
          value.loc,
        );
      case "ComputedLoad":
        return this.#evaluateComputedLoad(value);
      case "BinaryExpression":
        return foldBinary(value.operator, this.read(value.left), this.read(value.right));
      case "UnaryExpression":
        return foldUnary(value.operator, this.read(value.value));
      case "TypeCastExpression":
        return this.#evaluateTypeCast(value, walkState);
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
        return { kind: "JsxFragment", children: value.children.map((child) => this.read(child)) };
      case "Await":
        return createUnknown("async", value.loc);
      case "NewExpression":
        this.#passCallbacks(
          value.args.map((argument) => this.read(getPlaceOrSpread(argument))),
          value.loc,
          walkState,
        );
        return createUnknown(value.kind, value.loc);
      case "PropertyStore":
      case "ComputedStore":
        this.#passStoredCallback(value, walkState);
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
    const storedValue = this.read(store.value);
    const localValue =
      storedValue.kind === "HookResult" && getIdentifierName(store.lvalue.place) !== null
        ? this.#bindHookResult(store.lvalue.place, storedValue)
        : storedValue;
    this.write(store.lvalue.place, localValue);
    return localValue;
  }

  #evaluateComputedLoad(computedLoad: InstructionValueOfKind<"ComputedLoad">): SymbolicValue {
    const propertyKey = this.read(computedLoad.property);
    if (propertyKey.kind !== "Primitive" || isNullish(propertyKey.value))
      return this.#createDerivedValue(
        [this.read(computedLoad.object), propertyKey],
        "computed-member",
        computedLoad.loc,
      );
    return this.#evaluatePropertyLoad(
      this.read(computedLoad.object),
      String(propertyKey.value),
      computedLoad.loc,
    );
  }

  #evaluateTypeCast(
    typeCast: InstructionValueOfKind<"TypeCastExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const castValue = this.read(typeCast.value);
    const sourceDomain = this.#resolver.getDomain(typeCast.value.loc);
    if (typeCast.typeAnnotationKind === "non-null") {
      if (hasNullishCase(sourceDomain))
        this.#claim(createNonNullClaim(castValue, typeCast.loc, walkState.guards));
      return castValue;
    }
    const targetDomain = this.#resolver.getDomain(typeCast.loc);
    const claim = createCastClaim(
      castValue,
      sourceDomain,
      targetDomain,
      typeCast.loc,
      walkState.guards,
    );
    if (claim) this.#claim(claim);
    const isUntypedCast = castValue.kind === "Unknown" && sourceDomain.kind === "Unknown";
    const isNarrowingCast =
      castValue.kind !== "Primitive" &&
      !isLiteralDomain(sourceDomain) &&
      isLiteralDomain(targetDomain);
    return isUntypedCast || isNarrowingCast ? createUnknown("cast", typeCast.value.loc) : castValue;
  }

  #isCheckable(value: SymbolicValue): boolean {
    if (hasUnknownPart(value)) return false;
    let isCheckable = true;
    forEachSymbolicValue(value, (part) => {
      if (part.kind !== "Binding") return;
      if (part.binding.kind === "ref") isCheckable = false;
      const domain =
        this.bindingTable.placeDomains.get(getValuePlace(part)) ??
        (part.path.length === 0 ? part.binding.domain : undefined);
      if (domain?.kind !== "Cases") isCheckable = false;
    });
    return isCheckable;
  }

  #claim(claim: Omit<Claim, "file">): void {
    if (this.#isCheckable(claim.subject))
      this.#claims.push({ ...claim, file: this.#resolver.fileName });
  }

  #claimInvariant(callSite: CallSite, target: CallTarget, walkState: WalkState): void {
    const name =
      callSite.callee.kind === "Global"
        ? callSite.callee.name
        : target.kind === "ModuleFunction"
          ? target.hirFunction.id
          : null;
    const [test] = callSite.argumentValues;
    if (name === null || !CLAIM_FUNCTIONS.has(name) || test === undefined) return;
    this.#claim({
      kind: "invariant",
      subject: test,
      cases: null,
      test,
      guards: walkState.guards,
      description: `${name}(${describeCondition(test)})`,
      loc: callSite.loc,
    });
  }

  #evaluateObjectLiteral(objectLiteral: InstructionValueOfKind<"ObjectExpression">): SymbolicValue {
    const properties: ObjectExpressionValue["properties"] = [];
    const spreads: SymbolicValue[] = [];
    for (const property of objectLiteral.properties) {
      if (property.kind === "Spread") {
        spreads.push(this.read(property.place));
        continue;
      }
      const key = this.#getPropertyKey(property.key);
      if (key === null) return createUnknown("computed-key", objectLiteral.loc);
      properties.push({ key, value: this.read(property.place) });
    }
    return { kind: "ObjectExpression", properties, spreads };
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
    return this.#evaluateCall(
      {
        callee: this.read(call.callee),
        calleePlace: call.callee,
        argumentValues: argumentPlaces.map((place) => this.read(place)),
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
        children: (element.children ?? []).map((child) => this.read(child)),
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
    const previousWalkedCatches = this.walker.walkedCatches;
    this.walker.walkedCatches = new Set();
    this.#currentFunction = hirFunction;
    this.#resolver = this.#functions.getResolver(hirFunction) ?? previousResolver;
    const restoreLiveValues = this.#applyCapturedValues(functionId);
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
      restoreLiveValues();
      this.#currentFunction = previousFunction;
      this.#resolver = previousResolver;
      this.walker.walkedCatches = previousWalkedCatches;
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
  ): void {
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
      return;
    }
    if (callback.kind === "Setter")
      this.#handlerEffects?.recordSetterCall(callback.binding, EVENT_ARGUMENT, walkState);
    if (callback.kind === "Binding") this.#callBinding(callback, argumentValues, walkState);
    if (callback.kind !== "Function" || visitedFunctionIds.has(callback.functionId)) return;
    visitedFunctionIds.add(callback.functionId);
    const hirFunction = this.#functions.get(callback.functionId);
    if (hirFunction)
      this.#runRenderedHandlers(
        this.#evaluateFunction(hirFunction, argumentValues, walkState, callback.functionId),
        visitedFunctionIds,
      );
  }
}
