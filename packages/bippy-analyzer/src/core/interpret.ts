import type {
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  Phi,
  Place,
  SourceLocation,
  Terminal,
} from "../react-compiler/HIR/HIR";
import { GeneratedSource, getHookKind } from "../react-compiler/HIR/HIR";
import type { HookKind } from "../react-compiler/HIR/ObjectShape";
import { assertExhaustive } from "../react-compiler/Utils/utils";
import type { DomainResolver } from "./infer-domains";
import type {
  ArrayExpressionValue,
  Binding,
  BindingKind,
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
import { isHandlerProp } from "./collect-handlers";
import { PlaceMap, getBindingPlace, getValuePlace } from "./utils/place";
import { isExternalSource, isStateBinding } from "./utils/checks";
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
  isNullishValue,
} from "./symbolic-values";
import { BindingTable } from "./binding-table";
import type { BindingOptions } from "./binding-table";
import { buildJsx } from "./build-jsx";
import { Diagnostics } from "./diagnostics";
import { EffectCollector } from "./effect-collector";
import type { CollectedEffects } from "./effect-collector";
import { ExternalSources, getHookBindingKind, getStoreFieldValue } from "./external-sources";
import { FunctionRegistry } from "./function-registry";
import type { ModuleFunctionLoader } from "./function-registry";
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
// Whether each method's result keeps its receiver's length, rather than possibly being shorter.
const LENGTH_METHODS = new Map([
  ["filter", false],
  ["slice", false],
  ["toReversed", true],
  ["toSorted", true],
  ["with", true],
]);
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

// `chain` is the `.c()` of `a?.b.c()`; its branch only tests whether `a?.b` short-circuited.
type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "chain";

interface InterpreterBindingOptions extends BindingOptions {
  resolver?: DomainResolver;
}

interface WalkState {
  guards: SymbolicValue[];
  isAsync: boolean;
}

interface Definition {
  guards: SymbolicValue[];
  loopDepth: number;
}

interface EffectCall {
  hookKind: HookKind;
  callback: SymbolicValue;
  args: SymbolicValue[];
  dependencies: string | null;
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
  | { kind: "ModuleFunction"; fn: HIRFunction }
  | { kind: "Value" };

export interface ProjectHook {
  hirFunction: HIRFunction;
  resolver: DomainResolver;
  loadModuleFunction: ModuleFunctionLoader;
}

export type ProjectHookLoader = (declarationKey: string) => ProjectHook | null;

/** Runs HIR symbolically; phis at joins become `Conditional` values, so every branch is kept. */
export class Interpreter {
  #resolver: DomainResolver;
  readonly #loadProjectHook: ProjectHookLoader;
  readonly #tables = new WeakMap<object, CompilationTables>();
  readonly #functions = new FunctionRegistry();
  readonly bindingTable = new BindingTable();
  readonly externalSources: ExternalSources;
  readonly diagnostics = new Diagnostics();
  readonly effectCalls: EffectCall[] = [];
  readonly renderedComponents = new Set<string>();
  #wholePropsSample: Sample | null = null;
  #restPropsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  /** Set while a handler or effect runs; null during render. */
  #effects: EffectCollector | null = null;
  #currentFunction: HIRFunction | null = null;
  #blockVisits = 0;
  /** Where each array or object literal was created, to tell when a mutation always runs. */
  readonly #definitions = new WeakMap<SymbolicValue, Definition>();
  #loopDepth = 0;
  /** Headers of the loops being walked, and whether this walk has entered each yet. */
  readonly #loopHeaders = new Map<BlockId, boolean>();
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

  #registerFunction(fn: HIRFunction, isSnapshot = false): FunctionValue {
    return this.#functions.register(fn, this.#resolver, isSnapshot);
  }

  // Closures created in an inlined call snapshot their captures; others read them live.
  #createClosure(fn: HIRFunction): FunctionValue {
    const closure = this.#registerFunction(fn, this.#inlineDepth > 0);
    if (this.#inlineDepth > 0)
      this.#functions.setCapturedValues(
        closure.functionId,
        fn.context.map((place): [Place, SymbolicValue] => [place, this.#read(place)]),
      );
    return closure;
  }

  #applyCaptures(functionId: number | null): () => void {
    const captures = this.#functions.getCapturedValues(functionId);
    const previous = captures.map(([place]): [Place, SymbolicValue] => [place, this.#read(place)]);
    for (const [place, value] of captures) this.#write(place, value);
    return () => {
      for (const [place, value] of previous) this.#write(place, value);
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

  // Each compilation numbers identifiers from zero, so tables are kept per compilation.
  #getTables(): CompilationTables {
    const { env } = this.#getCurrentFunction();
    const tables = this.#tables.get(env) ?? {
      values: new Map(),
      propertyNames: new Map(),
      branchOperators: new Map(),
    };
    this.#tables.set(env, tables);
    return tables;
  }

  #read(place: Place): SymbolicValue {
    return (
      this.#getTables().values.get(place.identifier.id) ?? createUnknown("free-variable", place.loc)
    );
  }

  #write(place: Place, value: SymbolicValue): void {
    this.#getTables().values.set(place.identifier.id, value);
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
    items: Array<Place | null>,
    value: SymbolicValue,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    if (value.kind === "ArrayExpression" && value.spreads.length === 0)
      return items.map((_, index) => value.elements[index] ?? UNDEFINED_VALUE);
    if (value.kind !== "HookResult") return items.map(() => null);
    const [valuePlace] = items;
    const [firstArgument, secondArgument] = value.args;
    if (STATE_HOOKS.has(value.hookKind) && valuePlace) {
      const initial = firstArgument && firstArgument.kind !== "Function" ? firstArgument : null;
      const isAsserted = initial?.kind === "Unknown" && initial.reason === "cast";
      const binding = this.#createBinding(
        getIdentifierName(valuePlace) ?? "state",
        "state",
        valuePlace.loc,
        {
          hookKind: value.hookKind,
          initial,
          ...(isAsserted && { domain: ASSERTED_DOMAIN }),
        },
      );
      return [createBindingValue(binding), { kind: "Setter", binding }];
    }
    if (value.hookKind === "useReducer" && valuePlace) {
      const binding = this.#createBinding(
        getIdentifierName(valuePlace) ?? "state",
        "reducer",
        valuePlace.loc,
        { hookKind: value.hookKind, initial: secondArgument ?? null },
      );
      return [
        createBindingValue(binding),
        {
          kind: "Dispatch",
          binding,
          reducer: firstArgument
            ? this.#resolveModuleFunction(firstArgument)
            : createUnknown("reducer", loc),
        },
      ];
    }
    return items.map((place) => (place ? this.#bindHookResult(place, value) : null));
  }

  #evaluateDestructure(instruction: Extract<InstructionValue, { kind: "Destructure" }>): void {
    const { pattern } = instruction.lvalue;
    const value = this.#read(instruction.value);
    if (pattern.kind === "ArrayPattern") {
      const items = pattern.items.map((item) => (item.kind === "Identifier" ? item : null));
      const destructured = this.#destructure(items, value, instruction.loc);
      pattern.items.forEach((item, index) => {
        if (item.kind === "Hole") return;
        const place = getPlaceOrSpread(item);
        this.#write(place, destructured[index] ?? createUnknown("destructure", place.loc));
      });
      return;
    }
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
      const localName = getIdentifierName(property.place) ?? key ?? "value";
      if (key === null) {
        this.#write(property.place, createUnknown("computed-key", property.place.loc));
      } else if (value.kind === "Props") {
        this.#write(
          property.place,
          createBindingValue(this.#getPropBinding(key, localName, property.place.loc)),
        );
      } else if (value.kind === "HookResult") {
        // One binding per hook call, so destructured fields stay paths of the same value.
        const binding = this.#createBinding(
          `${value.name}()`,
          getHookBindingKind(value.hookKind),
          value.loc,
          { hookKind: value.hookKind, resolver: this.externalSources.getHookResolver(value) },
        );
        this.externalSources.bindHookResult(binding, value, this.#resolver);
        this.#write(property.place, this.#readField(binding, [key], property.place.loc));
      } else {
        this.#write(property.place, this.#evaluatePropertyLoad(value, key, property.place.loc));
      }
    }
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
        // Reading a property of nullish throws, so a render past the read took the other arm.
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

  #getJsxTag(tag: Extract<InstructionValue, { kind: "JsxExpression" }>["tag"]): SymbolicValue {
    if (tag.kind === "BuiltinTag") return { kind: "Primitive", value: tag.name };
    return this.#read(tag);
  }

  // Whether a Suspense boundary is suspended is unknowable, so branch on it.
  #buildSuspense(element: JsxExpressionValue, terminalId: InstructionId): SymbolicValue {
    const fallback = element.props.find(
      (prop) => prop.kind === "JsxAttribute" && prop.name === "fallback",
    );
    if (!fallback) return element;
    const suspended = this.#createBinding("suspended", "suspense", element.loc, {
      domain: SUSPENDED_DOMAIN,
    });
    return {
      kind: "Conditional",
      test: createBindingValue(suspended),
      testKind: "truthy",
      consequent: { ...element, children: [fallback.value] },
      alternate: element,
      branch: { terminalId, probe: "none", loc: element.loc, file: this.#resolver.fileName },
      guardKeys: [],
    };
  }

  #callFunction(
    callee: FunctionValue,
    args: SymbolicValue[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const fn = this.#functions.get(callee.functionId);
    if (!fn || this.#inlineDepth >= MAX_INLINE_DEPTH) return createUnknown("call", loc);
    this.#inlineDepth++;
    try {
      return this.#evaluateFunction(fn, args, state, callee.functionId);
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

  #trackMutations(instruction: Instruction, state: WalkState): void {
    if (isFunctionCreation(instruction.value)) return;
    const mutatedLocals = new Set<SymbolicValue>();
    for (const effect of instruction.effects ?? []) {
      const place = getMutatedPlace(effect);
      if (!place) {
        const possiblePlace = getConditionallyMutatedPlace(effect);
        const possibleOperand =
          possiblePlace && possiblePlace.identifier.type.kind !== "Primitive"
            ? this.#read(possiblePlace)
            : null;
        if (possibleOperand?.kind === "Binding" && isStateBinding(possibleOperand.binding))
          this.#effects?.addPossibleMutation(possibleOperand.binding);
        continue;
      }
      const operand = this.#read(place);
      if (
        (operand.kind === "ArrayExpression" || operand.kind === "ObjectExpression") &&
        !mutatedLocals.has(operand)
      ) {
        mutatedLocals.add(this.#mutateLocal(instruction, place, operand, state));
        continue;
      }
      if (operand.kind !== "Binding") continue;
      const { binding } = operand;
      if (binding.kind === "prop")
        this.#warn(
          "prop-mutation",
          `mutates prop ${formatPlace(binding, operand.path)}`,
          place.loc,
        );
      else if (isStateBinding(binding) && this.#effects)
        this.#effects.addMutation(binding, place.loc);
      else if (isStateBinding(binding))
        this.#warn("render-mutation", `mutates ${binding.name} during render`, place.loc);
    }
  }

  // A mutation on the path that created the value always runs, so it applies as is. Others may
  // not run, or run many times, so the value widens to cover both. Every alias sees the change.
  #mutateLocal(
    instruction: Instruction,
    place: Place,
    operand: ArrayExpressionValue | ObjectExpressionValue,
    state: WalkState,
  ): SymbolicValue {
    const definition = this.#definitions.get(operand);
    const isCertain =
      definition !== undefined &&
      definition.guards === state.guards &&
      definition.loopDepth === this.#loopDepth;
    const next = this.#getMutatedValue(instruction, place, operand, isCertain);
    if (isCertain) this.#definitions.set(next, definition);
    const { values } = this.#getTables();
    for (const [identifierId, value] of values)
      if (value === operand) values.set(identifierId, next);
    return next;
  }

  #getMutatedValue(
    instruction: Instruction,
    place: Place,
    operand: ArrayExpressionValue | ObjectExpressionValue,
    isCertain: boolean,
  ): SymbolicValue {
    const { value, loc } = instruction;
    if (
      operand.kind === "ArrayExpression" &&
      value.kind === "MethodCall" &&
      value.receiver.identifier.id === place.identifier.id &&
      this.#getTables().propertyNames.get(value.property.identifier.id) === "push"
    ) {
      const items = value.args.flatMap((argument) =>
        argument.kind === "Identifier" ? [this.#read(argument)] : [],
      );
      const spreads = value.args.flatMap((argument) =>
        argument.kind === "Spread" ? [this.#read(argument.place)] : [],
      );
      return isCertain
        ? {
            ...operand,
            elements: [...operand.elements, ...items],
            spreads: [...operand.spreads, ...spreads],
          }
        : {
            ...operand,
            spreads: [
              ...operand.spreads,
              ...spreads,
              ...items.map((item): SymbolicValue => ({
                kind: "ArrayMap",
                array: createUnknown("mutation", loc),
                item,
                loc,
              })),
            ],
          };
    }
    if (
      operand.kind === "ObjectExpression" &&
      value.kind === "PropertyStore" &&
      value.object.identifier.id === place.identifier.id
    ) {
      const property = {
        key: String(value.property),
        value: isCertain ? this.#read(value.value) : createUnknown("mutation", loc),
      };
      return { ...operand, properties: [...operand.properties, property] };
    }
    return createUnknown("mutation", loc);
  }

  #getNextValue(
    argument: SymbolicValue | undefined,
    previous: SymbolicValue,
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    return argument?.kind === "Function"
      ? this.#callFunction(argument, [previous], loc, state)
      : (argument ?? UNDEFINED_VALUE);
  }

  #applySetter(setter: SetterValue, argument: SymbolicValue | undefined, state: WalkState): void {
    const previous = createBindingValue(setter.binding);
    const next = this.#getNextValue(argument, previous, setter.binding.loc, state);
    this.#effects?.recordSetterCall(setter.binding, next, state);
  }

  #applyDispatch(
    dispatch: DispatchValue,
    action: SymbolicValue | undefined,
    loc: SourceLocation,
    state: WalkState,
  ): void {
    const reducer = dispatch.reducer;
    const next =
      reducer.kind === "Function"
        ? this.#callFunction(
            reducer,
            [createBindingValue(dispatch.binding), action ?? UNDEFINED_VALUE],
            loc,
            state,
          )
        : createUnknown("dispatch", loc);
    this.#effects?.recordSetterCall(dispatch.binding, next, state);
  }

  #recordWholeProps(args: SymbolicValue[], argumentPlaces: Place[]): void {
    const propsPlace = argumentPlaces[args.findIndex((argument) => argument.kind === "Props")];
    if (propsPlace) this.#wholePropsSample ??= this.#resolver.getSamples(propsPlace.loc)[0] ?? null;
  }

  #getCallTarget(
    callee: SymbolicValue,
    calleePlace: Place,
    args: SymbolicValue[],
    loc: SourceLocation,
  ): CallTarget {
    // A portal renders its children in place, only into another container.
    if (this.#resolver.getReactExportName(loc) === "createPortal" && args[0])
      return { kind: "Portal", children: args[0] };
    const hookKind = getHookKind(this.#getCurrentFunction().env, calleePlace.identifier);
    if (hookKind === "Custom") {
      const projectHook = this.#findProjectHook(calleePlace);
      if (projectHook)
        return this.#inlineDepth < MAX_INLINE_DEPTH
          ? { kind: "ProjectHook", projectHook }
          : { kind: "Hook", hookKind };
      const storeKey = this.#resolver.getDeclarationKey(calleePlace.loc);
      const storeActions = storeKey ? this.externalSources.getStoreActions(storeKey) : undefined;
      if (storeKey && storeActions) return { kind: "Store", storeKey, storeActions };
    }
    if (hookKind !== null) return { kind: "Hook", hookKind };
    // A helper given a callback may wrap it or call it later, so inline it.
    const moduleFunction =
      callee.kind === "Global" && getPassedCallbacks(args).length > 0
        ? this.#functions.loadModuleFunction(this.#resolver, callee.name)
        : null;
    return moduleFunction ? { kind: "ModuleFunction", fn: moduleFunction } : { kind: "Value" };
  }

  #evaluateCall(
    callee: SymbolicValue,
    calleePlace: Place,
    args: SymbolicValue[],
    argumentPlaces: Place[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    this.#recordWholeProps(args, argumentPlaces);
    const target = this.#getCallTarget(callee, calleePlace, args, loc);
    switch (target.kind) {
      case "Portal":
        return target.children;
      case "ProjectHook":
        this.#functions.addModule(
          target.projectHook.resolver,
          target.projectHook.loadModuleFunction,
          target.projectHook.hirFunction,
        );
        return this.#callFunction(
          this.#registerFunction(target.projectHook.hirFunction),
          args,
          loc,
          state,
        );
      case "Store":
        return this.#readStore(target.storeKey, target.storeActions, callee, args, loc, state);
      case "Hook":
        return this.#evaluateHookCall(target.hookKind, callee, args, argumentPlaces, loc, state);
      case "ModuleFunction":
        return this.#callFunction(this.#registerFunction(target.fn), args, loc, state);
      case "Value":
        return this.#callValue(callee, calleePlace, args, argumentPlaces, loc, state);
      default:
        return assertExhaustive(target, "Unhandled call target");
    }
  }

  #callValue(
    callee: SymbolicValue,
    calleePlace: Place,
    args: SymbolicValue[],
    argumentPlaces: Place[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    switch (callee.kind) {
      case "Function":
        return this.#callFunction(callee, args, loc, state);
      case "Conditional":
        return {
          ...callee,
          consequent: this.#evaluateCall(
            callee.consequent,
            calleePlace,
            args,
            argumentPlaces,
            loc,
            state,
          ),
          alternate: this.#evaluateCall(
            callee.alternate,
            calleePlace,
            args,
            argumentPlaces,
            loc,
            state,
          ),
        };
      case "Setter":
        this.#applySetter(callee, args[0], state);
        return UNDEFINED_VALUE;
      case "Dispatch":
        this.#applyDispatch(callee, args[0], loc, state);
        return UNDEFINED_VALUE;
      case "Binding":
        if (this.#effects && !this.#resolver.isNonMutatingMethod(calleePlace.loc))
          this.#callBinding(callee, args, state);
        break;
      default:
        break;
    }
    for (const argument of args) this.#visitCallbackArgument(argument, state);
    if (this.#effects) return createUnknown("call", loc);
    if (!this.#resolver.isNonMutatingMethod(calleePlace.loc)) this.#addLaterCallbacks(args, loc);
    if (this.#resolver.isReactElement(loc)) {
      this.diagnostics.bailOut("unknown-call", "call returns JSX the analysis can't see into", loc);
      return createUnknown("call", loc);
    }
    return this.#createCallResult(callee, calleePlace, args, loc);
  }

  #collectInputs(value: SymbolicValue, inputs: PlaceMap<true>, visited = new Set<number>()): void {
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") inputs.set(getValuePlace(part), true);
      if (part.kind !== "Function" || visited.has(part.functionId)) return;
      visited.add(part.functionId);
      for (const place of this.#functions.get(part.functionId)?.context ?? [])
        this.#collectInputs(this.#read(place), inputs, visited);
    });
  }

  #createCallResult(
    callee: SymbolicValue,
    calleePlace: Place,
    args: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(loc);
    if (calleeText === null) return createUnknown("call", loc);
    const inputs = new PlaceMap<true>();
    for (const argument of args) this.#collectInputs(argument, inputs);
    const method = callee.kind === "Binding" ? callee.path.at(-1) : undefined;
    const receiver =
      callee.kind === "Binding" && method !== undefined
        ? getBindingPlace(callee.binding, callee.path.slice(0, -1))
        : null;
    const isSameLength = method === undefined ? undefined : LENGTH_METHODS.get(method);
    const lengthLimit =
      receiver && isSameLength !== undefined && this.#resolver.isNonMutatingMethod(calleePlace.loc)
        ? { arrayLength: { ...receiver, path: [...receiver.path, "length"] }, isSameLength }
        : null;
    if (!lengthLimit && inputs.size === 0 && this.#resolver.getDomain(loc).kind !== "Cases")
      return createUnknown("call", loc);
    if (receiver) inputs.set(receiver, true);
    const name = `${calleeText}(${args.map(formatSymbolicValue).join(", ")})`;
    return createBindingValue(
      this.#createBinding(name, "call", loc, { inputPlaces: inputs.places(), lengthLimit }),
    );
  }

  #visitCallbackArgument(argument: SymbolicValue, state: WalkState): void {
    if (!this.#effects) return;
    if (argument.kind === "ObjectExpression")
      for (const callback of getPassedCallbacks([argument]))
        this.#visitCallbackArgument(callback, state);
    const asyncState = { ...state, isAsync: true };
    if (argument.kind === "Setter")
      this.#effects.recordSetterCall(
        argument.binding,
        createUnknown("callback-argument", GeneratedSource),
        asyncState,
      );
    if (argument.kind === "Function")
      this.#callFunction(
        argument,
        [createUnknown("callback-argument", argument.loc)],
        argument.loc,
        asyncState,
      );
  }

  #storeCallback(value: SymbolicValue, loc: SourceLocation, state: WalkState): void {
    if (value.kind === "Function") this.#passCallbacks([value], loc, state);
  }

  #passCallbacks(args: SymbolicValue[], loc: SourceLocation, state: WalkState): void {
    if (!this.#effects) this.#addLaterCallbacks(args, loc);
    else for (const argument of args) this.#visitCallbackArgument(argument, state);
  }

  #evaluateHookCall(
    hookKind: HookKind,
    callee: SymbolicValue,
    args: SymbolicValue[],
    argumentPlaces: Place[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    if (EFFECT_HOOKS.has(hookKind)) {
      const [callback] = args;
      const [, dependencies] = argumentPlaces;
      if (callback)
        this.effectCalls.push({
          hookKind,
          callback,
          args: [],
          dependencies: dependencies ? this.#resolver.getSourceText(dependencies.loc) : null,
          loc,
        });
      return UNDEFINED_VALUE;
    }
    if (hookKind === "Custom") this.#addLaterCallbacks(args, loc);
    if (hookKind === "useImperativeHandle" && args[1]?.kind === "Function")
      this.#addLaterCallbacks([this.#callFunction(args[1], [], loc, state)], loc);
    if (hookKind === "useMemo" && args[0]?.kind === "Function")
      return this.#callFunction(args[0], [], loc, state);
    if (hookKind === "useCallback" && args[0]) return args[0];
    const name = callee.kind === "Global" ? callee.name : hookKind;
    const hookModule = callee.kind === "Global" ? callee.module : null;
    const hookResult: HookResultValue = {
      kind: "HookResult",
      hookKind,
      name,
      module: hookModule,
      args,
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

  // Callbacks passed into opaque calls may run after any render, with any arguments.
  #addLaterCallbacks(args: SymbolicValue[], loc: SourceLocation): void {
    for (const callback of getPassedCallbacks(args)) {
      if (callback.kind !== "Function") continue;
      const parameters = this.#functions.get(callback.functionId)?.params ?? [];
      this.effectCalls.push({
        hookKind: "Custom",
        callback,
        args: parameters.map(() => createUnknown("callback-argument", callback.loc)),
        dependencies: null,
        loc,
      });
    }
  }

  #evaluateMethodCall(
    instruction: Extract<InstructionValue, { kind: "MethodCall" }>,
    state: WalkState,
  ): SymbolicValue {
    const receiver = this.#read(instruction.receiver);
    const propertyName =
      this.#getTables().propertyNames.get(instruction.property.identifier.id) ?? null;
    const argumentPlaces = instruction.args.map(getPlaceOrSpread);
    const args = argumentPlaces.map((place) => this.#read(place));
    const [callback] = args;
    if (
      this.#effects &&
      propertyName !== null &&
      ITERATION_METHODS.has(propertyName) &&
      receiver.kind === "ArrayExpression" &&
      callback?.kind === "Function"
    ) {
      const items = [
        ...receiver.elements,
        ...receiver.spreads.map(() => createUnknown("item", instruction.loc)),
      ];
      for (const item of items) this.#callFunction(callback, [item], instruction.loc, state);
      return createUnknown("call", instruction.loc);
    }
    if (propertyName === "map" && callback?.kind === "Function") {
      const parameter = this.#functions.get(callback.functionId)?.params[0];
      const itemPlace = parameter ? getPlaceOrSpread(parameter) : null;
      const item: SymbolicValue = itemPlace
        ? createBindingValue(
            this.#createBinding(getIdentifierName(itemPlace) ?? "item", "item", itemPlace.loc),
          )
        : createUnknown("item", instruction.loc);
      return {
        kind: "ArrayMap",
        array: receiver,
        item: this.#callFunction(callback, [item], instruction.loc, state),
        loc: instruction.loc,
      };
    }
    if (propertyName !== null && PROMISE_METHODS.has(propertyName)) {
      for (const argument of args)
        this.#visitCallbackArgument(argument, { ...state, isAsync: true });
      return createUnknown("async", instruction.loc);
    }
    return this.#evaluateCall(
      this.#read(instruction.property),
      instruction.property,
      args,
      argumentPlaces,
      instruction.loc,
      state,
    );
  }

  #evaluateInstruction(instruction: Instruction, state: WalkState): void {
    const { value } = instruction;
    if (value.kind === "PropertyLoad")
      this.#getTables().propertyNames.set(instruction.lvalue.identifier.id, String(value.property));
    this.#trackMutations(instruction, state);
    const result = this.#evaluateInstructionValue(instruction, state);
    if (value.kind === "ArrayExpression" || value.kind === "ObjectExpression")
      this.#definitions.set(result, { guards: state.guards, loopDepth: this.#loopDepth });
    this.#write(instruction.lvalue, result);
  }

  #evaluateInstructionValue(instruction: Instruction, state: WalkState): SymbolicValue {
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
      case "StoreContext": {
        const stored = this.#read(value.value);
        const bound =
          stored.kind === "HookResult" && getIdentifierName(value.lvalue.place) !== null
            ? this.#bindHookResult(value.lvalue.place, stored)
            : stored;
        this.#write(value.lvalue.place, bound);
        return bound;
      }
      case "DeclareLocal":
      case "DeclareContext":
        this.#write(value.lvalue.place, UNDEFINED_VALUE);
        return UNDEFINED_VALUE;
      case "Destructure":
        this.#evaluateDestructure(value);
        return this.#read(value.value);
      case "LoadGlobal":
        if (value.binding.kind === "Global" && value.binding.name === "undefined")
          return UNDEFINED_VALUE;
        return {
          kind: "Global",
          name: value.binding.name,
          module: "module" in value.binding ? value.binding.module : null,
        };
      case "PropertyLoad":
        return this.#evaluatePropertyLoad(
          this.#read(value.object),
          String(value.property),
          value.loc,
        );
      case "ComputedLoad": {
        const property = this.#read(value.property);
        return property.kind === "Primitive" &&
          property.value !== null &&
          property.value !== undefined
          ? this.#evaluatePropertyLoad(this.#read(value.object), String(property.value), value.loc)
          : createUnknown("computed-member", value.loc);
      }
      case "BinaryExpression":
        return foldBinary(value.operator, this.#read(value.left), this.#read(value.right));
      case "UnaryExpression":
        return foldUnary(value.operator, this.#read(value.value));
      case "TypeCastExpression": {
        const operand = this.#read(value.value);
        return operand.kind === "Unknown" &&
          this.#resolver.getDomain(value.value.loc).kind === "Unknown"
          ? createUnknown("cast", value.value.loc)
          : operand;
      }
      case "ObjectExpression":
        return {
          kind: "ObjectExpression",
          properties: value.properties.flatMap((property) =>
            property.kind === "ObjectProperty" &&
            (property.key.kind === "string" || property.key.kind === "identifier")
              ? [{ key: property.key.name, value: this.#read(property.place) }]
              : [],
          ),
          spreads: value.properties.flatMap((property) =>
            property.kind === "Spread" ? [this.#read(property.place)] : [],
          ),
        };
      case "ArrayExpression":
        return {
          kind: "ArrayExpression",
          elements: value.elements.flatMap((element): SymbolicValue[] =>
            element.kind === "Identifier"
              ? [this.#read(element)]
              : element.kind === "Hole"
                ? [UNDEFINED_VALUE]
                : [],
          ),
          spreads: value.elements.flatMap((element) =>
            element.kind === "Spread" ? [this.#read(element.place)] : [],
          ),
        };
      case "FunctionExpression":
      case "ObjectMethod":
        return this.#createClosure(value.loweredFunc.func);
      case "CallExpression": {
        const argumentPlaces = value.args.map(getPlaceOrSpread);
        return this.#evaluateCall(
          this.#read(value.callee),
          value.callee,
          argumentPlaces.map((place) => this.#read(place)),
          argumentPlaces,
          value.loc,
          state,
        );
      }
      case "MethodCall":
        return this.#evaluateMethodCall(value, state);
      case "JsxExpression": {
        const props = value.props.map((attribute): JsxProp | JsxSpreadProp =>
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
        const tag = this.#getJsxTag(value.tag);
        const providedValue = props.find(
          (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "value",
        );
        const contextKey =
          providedValue && value.tag.kind !== "BuiltinTag"
            ? this.#resolver.getContextKey(value.tag.loc)
            : null;
        if (providedValue && contextKey)
          this.providedContexts.push({ contextKey, value: providedValue.value });
        const element = buildJsx(
          tag,
          {
            declaration:
              value.tag.kind === "BuiltinTag"
                ? null
                : this.#resolver.getDeclarationKey(value.tag.loc),
            isContext: value.tag.kind !== "BuiltinTag" && this.#resolver.isContext(value.tag.loc),
            props,
            children: (value.children ?? []).map((child) => this.#read(child)),
            loc: value.loc,
          },
          this.renderedComponents,
        );
        return this.#resolver.getReactExportName(value.tag.loc) === "Suspense" &&
          element.kind === "JsxExpression"
          ? this.#buildSuspense(element, instruction.id)
          : element;
      }
      case "JsxFragment":
        return { kind: "JsxFragment", children: value.children.map((child) => this.#read(child)) };
      case "Await":
        return createUnknown("async", value.loc);
      case "NewExpression": {
        const args = value.args.map((argument) => this.#read(getPlaceOrSpread(argument)));
        this.#passCallbacks(args, value.loc, state);
        return createUnknown(value.kind, value.loc);
      }
      case "PropertyStore":
      case "ComputedStore":
        this.#storeCallback(this.#read(value.value), value.loc, state);
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

  // Merges phis when every path reaches the join, else walks the rest once per arriving path.
  // A join an enclosing walk stops at is left for that walk to merge.
  #continueAfter(
    outcome: Outcome,
    join: BlockId,
    stops: ReadonlySet<BlockId>,
    state: WalkState,
    hasResolvedPhis = false,
  ): Outcome {
    if (stops.has(join)) return outcome;
    const block = this.#getBlock(join);
    if (isFallthroughOnly(outcome, join)) {
      if (!hasResolvedPhis)
        for (const phi of block.phis)
          this.#write(phi.place, this.#resolvePhi(phi, outcome, state.guards));
      return this.#walk(join, stops, null, state, true);
    }
    const resume = (current: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (current.kind) {
        case "Return":
          return current;
        case "Fallthrough":
          return current.to === join
            ? this.#walk(join, stops, current.from, { ...state, guards }, hasResolvedPhis)
            : current;
        case "Split":
          return {
            ...current,
            consequent: resume(current.consequent, [...guards, getGuard(current, true)]),
            alternate: resume(current.alternate, [...guards, getGuard(current, false)]),
          };
        default:
          return assertExhaustive(current, "Unhandled outcome");
      }
    };
    return hasFallthrough(outcome, join) ? resume(outcome, state.guards) : outcome;
  }

  #getBlock(blockId: BlockId) {
    const block = this.#getCurrentFunction().body.blocks.get(blockId);
    if (!block) throw new Error(`Block bb${blockId} is missing`);
    return block;
  }

  #split(
    terminal: BranchTerminal,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    state: WalkState,
  ): Outcome {
    const { test, consequent, alternate, fallthrough } = terminal;
    const operator = this.#getTables().branchOperators.get(fallthrough) ?? "ternary";
    const chainValue = this.#read(test);
    const shortCircuit = operator === "chain" ? getShortCircuit(chainValue) : null;
    const testValue = shortCircuit?.test ?? chainValue;
    const testKind: TestKind =
      shortCircuit?.testKind ??
      (operator === "??" || operator === "optional" || operator === "chain" ? "nullish" : "truthy");
    const branch: Branch = {
      terminalId: terminal.id,
      probe: this.#resolver.isExpression(test.loc) ? testKind : "none",
      loc: test.loc,
      file: this.#resolver.fileName,
    };
    const testGuard = getTestExpression({ test: testValue, testKind });
    const walkArm = (block: BlockId, isConsequent: boolean): Outcome => {
      const guards = [...state.guards, isConsequent ? testGuard : negate(testGuard)];
      return block === fallthrough || stops.has(block)
        ? { kind: "Fallthrough", from, to: block }
        : this.#walk(block, new Set([...stops, fallthrough]), from, { ...state, guards }, false);
    };
    const consequentOutcome = walkArm(consequent, true);
    const alternateOutcome = walkArm(alternate, false);
    const isSwapped = operator === "&&";
    const decided =
      operator === "chain" && !shortCircuit ? true : getKnownOutcome(testValue, testKind);
    const split: Outcome =
      decided !== null
        ? decided !== isSwapped
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
    return this.#continueAfter(split, fallthrough, stops, state);
  }

  #walkSwitch(
    terminal: Extract<Terminal, { kind: "switch" }>,
    from: BlockId,
    stops: ReadonlySet<BlockId>,
    state: WalkState,
  ): Outcome {
    const caseStops = new Set([...stops, terminal.fallthrough]);
    const discriminant = this.#read(terminal.test);
    const buildCases = (index: number): Outcome => {
      const switchCase = terminal.cases[index];
      if (!switchCase) return { kind: "Fallthrough", from, to: terminal.fallthrough };
      const caseOutcome: Outcome =
        switchCase.block === terminal.fallthrough
          ? { kind: "Fallthrough", from, to: terminal.fallthrough }
          : this.#walk(switchCase.block, caseStops, from, state, false);
      if (switchCase.test === null) return caseOutcome;
      const test = foldBinary("===", discriminant, this.#read(switchCase.test));
      if (test.kind === "Primitive") return test.value ? caseOutcome : buildCases(index + 1);
      return {
        kind: "Split",
        test,
        testKind: "truthy",
        branch: {
          terminalId: terminal.id,
          probe: "none",
          loc: switchCase.test.loc,
          file: this.#resolver.fileName,
        },
        consequent: caseOutcome,
        alternate: buildCases(index + 1),
      };
    };
    return this.#continueAfter(buildCases(0), terminal.fallthrough, stops, state);
  }

  // One walk of the body covers every iteration: each value the loop carries becomes a binding its
  // type bounds, and leaving through `continue` is leaving through the test.
  #walkLoop(terminal: LoopTerminal, stops: ReadonlySet<BlockId>, state: WalkState): Outcome {
    const headers = getLoopHeaders(terminal);
    const loopBindings: Binding[] = [];
    for (const header of headers) {
      this.#loopHeaders.set(header, false);
      for (const phi of this.#getBlock(header).phis)
        this.#write(phi.place, this.#createLoopValue(phi, loopBindings));
    }
    const [entry = terminal.fallthrough] = headers;
    this.#loopDepth++;
    let outcome: Outcome;
    try {
      outcome = this.#walk(entry, new Set([...stops, terminal.fallthrough]), null, state, true);
    } finally {
      this.#loopDepth--;
      for (const header of headers) this.#loopHeaders.delete(header);
    }
    // Which iteration leaves is unknown, so values merging where the loop ends are bound too.
    for (const phi of this.#getBlock(terminal.fallthrough).phis)
      this.#write(phi.place, this.#createLoopValue(phi, loopBindings));
    this.#addLoopInputs(loopBindings, entry, terminal.fallthrough);
    const exit: Outcome = {
      kind: "Fallthrough",
      from: getLoopExit(terminal),
      to: terminal.fallthrough,
    };
    const exited = mapFallthroughs(outcome, (fallthrough) =>
      fallthrough.to === terminal.fallthrough || headers.includes(fallthrough.to)
        ? exit
        : fallthrough,
    );
    return this.#continueAfter(exited, terminal.fallthrough, stops, state, true);
  }

  // Typed as declared, since the value of any iteration may reach here.
  #createLoopValue(phi: Phi, loopBindings: Binding[]): SymbolicValue {
    const name = getIdentifierName(phi.place);
    const loc = [phi.place, ...phi.operands.values()]
      .map(getDeclarationLocation)
      .find((candidate) => this.#resolver.getDeclaredDomain(candidate) !== null);
    const domain = loc && this.#resolver.getDeclaredDomain(loc);
    if (name === null || !loc || !domain) return createUnknown("loop", phi.place.loc);
    const binding = this.#createBinding(name, "loop", loc, { domain });
    if (!loopBindings.includes(binding)) loopBindings.push(binding);
    return createBindingValue(binding);
  }

  // A value the loop carries may depend on anything the loop reads.
  #addLoopInputs(loopBindings: Binding[], entry: BlockId, exit: BlockId): void {
    if (loopBindings.length === 0) return;
    const inputs = new PlaceMap<true>();
    const seen = new Set([entry, exit]);
    const queue = [entry];
    for (const blockId of queue) {
      const block = this.#getBlock(blockId);
      for (const instruction of block.instructions)
        this.#collectInputs(this.#read(instruction.lvalue), inputs);
      for (const successor of eachTerminalSuccessor(block.terminal)) {
        if (seen.has(successor)) continue;
        seen.add(successor);
        queue.push(successor);
      }
    }
    const loopIds = new Set(loopBindings.map((binding) => binding.id));
    const places = inputs.places().filter((place) => !loopIds.has(place.bindingId));
    for (const binding of loopBindings) binding.inputPlaces = [...binding.inputPlaces, ...places];
  }

  #walk(
    blockId: BlockId,
    stops: ReadonlySet<BlockId>,
    from: BlockId | null,
    state: WalkState,
    hasResolvedPhis: boolean,
  ): Outcome {
    let currentId = blockId;
    let previousId = from;
    let isPhiResolved = hasResolvedPhis;
    let currentState = state;
    while (true) {
      if (++this.#blockVisits > MAX_BLOCK_VISITS) {
        this.diagnostics.bailOut("too-complex", "visits too many blocks", GeneratedSource);
        return { kind: "Return", value: createUnknown("too-complex", GeneratedSource) };
      }
      const isLoopHeader = this.#loopHeaders.has(currentId);
      if (isLoopHeader) {
        if (this.#loopHeaders.get(currentId))
          return { kind: "Fallthrough", from: previousId, to: currentId };
        this.#loopHeaders.set(currentId, true);
      }
      const block = this.#getBlock(currentId);
      if (!isPhiResolved && !isLoopHeader) {
        for (const phi of block.phis)
          this.#write(
            phi.place,
            this.#resolvePhi(
              phi,
              { kind: "Fallthrough", from: previousId, to: currentId },
              currentState.guards,
            ),
          );
      }
      for (const instruction of block.instructions) {
        this.#evaluateInstruction(instruction, currentState);
        if (instruction.value.kind === "Await") currentState = { ...currentState, isAsync: true };
      }
      const { terminal } = block;
      let nextId: BlockId;
      let nextFrom: BlockId | null = currentId;
      switch (terminal.kind) {
        case "return":
          return { kind: "Return", value: this.#read(terminal.value) };
        case "throw":
        case "unreachable":
        case "unsupported":
          return { kind: "Return", value: createUnknown(terminal.kind, terminal.loc) };
        case "goto":
          if (stops.has(terminal.block))
            return { kind: "Fallthrough", from: currentId, to: terminal.block };
          nextId = terminal.block;
          break;
        case "if":
        case "branch":
          return this.#split(terminal, currentId, stops, currentState);
        case "switch":
          return this.#walkSwitch(terminal, currentId, stops, currentState);
        case "ternary":
        case "logical":
        case "optional":
          this.#getTables().branchOperators.set(
            terminal.fallthrough,
            terminal.kind === "logical"
              ? terminal.operator
              : terminal.kind === "optional" && !terminal.optional
                ? "chain"
                : terminal.kind,
          );
          return this.#continueAfter(
            this.#walk(
              terminal.test,
              new Set([...stops, terminal.fallthrough]),
              currentId,
              currentState,
              false,
            ),
            terminal.fallthrough,
            stops,
            currentState,
          );
        case "label":
        case "sequence":
        case "try":
        case "scope":
        case "pruned-scope":
          nextId = terminal.block;
          break;
        case "maybe-throw":
          // A `catch` runs when the `try` throws, like a failed request; walk it once per call.
          if (
            this.#effects &&
            terminal.handler !== null &&
            !this.#walkedCatches.has(terminal.handler)
          ) {
            this.#walkedCatches.add(terminal.handler);
            this.#walk(terminal.handler, stops, currentId, currentState, false);
          }
          nextId = terminal.continuation;
          break;
        case "for":
        case "for-of":
        case "for-in":
        case "while":
        case "do-while":
          return this.#walkLoop(terminal, stops, currentState);
        default:
          return assertExhaustive(terminal, "Unhandled terminal");
      }
      previousId = nextFrom;
      currentId = nextId;
      isPhiResolved = false;
    }
  }

  #toValue(outcome: Outcome, loc: SourceLocation, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return createConditional(outcome, guards, (arm, armGuards) =>
          this.#toValue(arm, loc, armGuards),
        );
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #readStore(
    storeKey: string,
    model: StoreActions,
    callee: SymbolicValue,
    args: SymbolicValue[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const name = callee.kind === "Global" ? callee.name : "store";
    const binding = this.externalSources.getStoreBinding(storeKey, model, () =>
      this.#createBinding(`${name}()`, "hook", loc, {
        hookKind: "Custom",
        domain: { kind: "Opaque", typeText: name },
      }),
    );
    const [selector] = args;
    return selector?.kind === "Function"
      ? this.#callFunction(selector, [createBindingValue(binding)], loc, state)
      : createBindingValue(binding);
  }

  #findProjectHook(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#loadProjectHook(declarationKey) : null;
  }

  #evaluateFunction(
    fn: HIRFunction,
    args: SymbolicValue[],
    state: WalkState,
    functionId: number | null = null,
  ): SymbolicValue {
    const previousFunction = this.#currentFunction;
    const previousResolver = this.#resolver;
    const previousCatches = this.#walkedCatches;
    this.#walkedCatches = new Set();
    this.#currentFunction = fn;
    this.#resolver = this.#functions.getResolver(fn) ?? previousResolver;
    const restoreCaptures = this.#applyCaptures(functionId);
    try {
      fn.params.forEach((parameter, index) => {
        const place = getPlaceOrSpread(parameter);
        this.#write(
          place,
          parameter.kind === "Spread"
            ? {
                kind: "ArrayExpression",
                elements: args.slice(index),
                spreads: [createUnknown("rest", place.loc)],
              }
            : (args[index] ?? UNDEFINED_VALUE),
        );
      });
      return this.#toValue(
        this.#walk(fn.body.entry, NO_STOPS, null, state, false),
        fn.loc,
        state.guards,
      );
    } finally {
      restoreCaptures();
      this.#currentFunction = previousFunction;
      this.#resolver = previousResolver;
      this.#walkedCatches = previousCatches;
    }
  }

  get wholePropsSample(): Sample | null {
    return this.#wholePropsSample ?? this.#restPropsSample;
  }

  evaluateComponent(fn: HIRFunction): SymbolicValue {
    this.#blockVisits = 0;
    return this.#evaluateFunction(fn, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  #callBinding(callee: BindingValue, args: SymbolicValue[], state: WalkState): void {
    const { binding, path } = callee;
    if (binding.kind === "prop") this.#effects?.addDelegate(formatPlace(binding, path));
    const member = path.length === 1 ? path[0] : undefined;
    const contextField = member && this.externalSources.getSetterField(binding, member);
    if (contextField) return this.#setContextField(binding, contextField, args[0], state);
    const assignments = member && this.externalSources.getActionAssignments(binding, member);
    if (assignments)
      return this.#effects?.recordSetterCall(
        binding,
        {
          kind: "ObjectExpression",
          properties: assignments.map((assignment) => ({
            key: assignment.field,
            value: getStoreFieldValue(binding, assignment, args),
          })),
          spreads: [createBindingValue(binding)],
        },
        state,
      );
    if (isExternalSource(binding) && this.#effects)
      this.#recordExternalUpdate(this.#effects, callee, state);
  }

  // Async because a provider may not be mounted, and default context setters are often no-ops.
  #setContextField(
    binding: Binding,
    field: string,
    argument: SymbolicValue | undefined,
    state: WalkState,
  ): void {
    if (!this.#effects) return;
    const previous: SymbolicValue = { kind: "Binding", binding, path: [field] };
    const next = this.#getNextValue(argument, previous, binding.loc, state);
    this.#effects.addUpdate(
      binding,
      {
        kind: "ObjectExpression",
        properties: [{ key: field, value: this.#effects.forgetMutatedBindings(next) }],
        spreads: [createBindingValue(binding)],
      },
      state.guards,
      true,
    );
  }

  // Calling into a hook or context value may change it, and every hook from its module, anytime.
  #recordExternalUpdate(effects: EffectCollector, callee: BindingValue, state: WalkState): void {
    effects.addDelegate(formatPlace(callee.binding, callee.path));
    const sources = this.bindingTable.bindings.filter(
      (binding) =>
        binding.id === callee.binding.id ||
        this.externalSources.isFromSameModule(callee.binding, binding),
    );
    for (const binding of sources)
      if (!effects.hasUpdate(binding))
        effects.addUpdate(binding, createUnknown("external", GeneratedSource), state.guards, true);
  }

  // Handlers in JSX a handler returns, like render-prop output, are rendered for the user to click.
  #collectRenderedHandlers(value: SymbolicValue, visited: Set<number>): void {
    const event = createUnknown("event", GeneratedSource);
    forEachJsxElement(value, (element) => {
      for (const prop of element.props)
        if (prop.kind === "JsxAttribute" && isHandlerProp(element.tag, prop))
          this.#runCallback(prop.value, [event], visited);
    });
  }

  #runCallback(callback: SymbolicValue, args: SymbolicValue[], visited: Set<number>): void {
    if (callback.kind === "Setter")
      this.#effects?.recordSetterCall(
        callback.binding,
        createUnknown("event", GeneratedSource),
        ROOT_WALK_STATE,
      );
    if (callback.kind === "Binding") this.#callBinding(callback, args, ROOT_WALK_STATE);
    if (callback.kind !== "Function" || visited.has(callback.functionId)) return;
    visited.add(callback.functionId);
    const fn = this.#functions.get(callback.functionId);
    if (fn)
      this.#collectRenderedHandlers(
        this.#evaluateFunction(fn, args, ROOT_WALK_STATE, callback.functionId),
        visited,
      );
  }

  collectEffects(callback: SymbolicValue, args: SymbolicValue[]): CollectedEffects {
    const previousEffects = this.#effects;
    const previousBlockVisits = this.#blockVisits;
    const effects = new EffectCollector((kind, message, loc) => this.#warn(kind, message, loc));
    this.#effects = effects;
    this.#blockVisits = 0;
    try {
      const callbacks =
        callback.kind === "ObjectExpression"
          ? callback.properties.map((property) => property.value)
          : [callback];
      for (const each of callbacks) this.#runCallback(each, args, new Set());
      if (callback.kind === "Unknown")
        for (const binding of this.bindingTable.bindings)
          if (isExternalSource(binding))
            this.#recordExternalUpdate(effects, createBindingValue(binding), ROOT_WALK_STATE);
      return effects.finish();
    } finally {
      this.#effects = previousEffects;
      this.#blockVisits = previousBlockVisits;
    }
  }
}
