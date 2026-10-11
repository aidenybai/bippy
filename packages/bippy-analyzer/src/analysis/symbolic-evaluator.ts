import type { AliasingEffect } from "../compiler/inference/aliasing-effects.js";
import type {
  BlockId,
  HIRFunction,
  IdentifierId,
  Instruction,
  InstructionValue,
  Phi,
  Place,
  SourceLocation,
  SpreadPattern,
  Terminal,
} from "../compiler/hir/hir.js";
import { GeneratedSource, getHookKind } from "../compiler/hir/hir.js";
import type { HookKind } from "../compiler/hir/object-shape.js";
import { assertExhaustive } from "../compiler/utils/utils.js";
import type { DomainResolver } from "./infer-domains.js";
import type {
  Bailout,
  BailoutReason,
  Binding,
  BindingKind,
  BindingValue,
  ConditionalValue,
  Decision,
  DispatchValue,
  Domain,
  FunctionValue,
  HookResultValue,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  SetterValue,
  StateUpdate,
  SymbolicValue,
  TestKind,
  Warning,
  WarningKind,
} from "./types.js";
import {
  formatPlace,
  forEachSymbolicValue,
  formatSymbolicValue,
  getBindingPlaceKey,
  isExternalSource,
  isNullish,
  isStateBinding,
  isWholeBinding,
  getKnownTruthiness,
  getPlaceKey,
  getTestExpression,
  mapSymbolicValue,
  negate,
} from "./values.js";

const MAX_BLOCK_VISITS = 20_000;
const MAX_INLINE_DEPTH = 4;
const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic", "useActionState"]);
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);

/**
 * How a region of the control-flow graph ended: by returning, by falling through from
 * `from` to `to`, one of the joins the walk stops at, or by splitting on a decision into
 * two outcomes.
 */
type Outcome =
  | { kind: "Return"; value: SymbolicValue }
  | { kind: "Fallthrough"; from: BlockId | null; to: BlockId }
  | SplitOutcome;

interface SplitOutcome {
  kind: "Split";
  test: SymbolicValue;
  testKind: TestKind;
  decision: Decision;
  consequent: Outcome;
  alternate: Outcome;
}

/**
 * `chain` is the non-optional part of an optional chain, like `.c()` in `a?.b.c()`. Its
 * branch only asks whether the chain before it short-circuited.
 */
type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "chain";

type EvaluationMode = "render" | "effect";

interface WalkState {
  guards: SymbolicValue[];
  isAsync: boolean;
}

interface EffectCall {
  hookKind: HookKind;
  callback: SymbolicValue;
  dependencies: SourceLocation | null;
  loc: SourceLocation;
}

interface CollectedEffects {
  updates: StateUpdate[];
  delegates: string[];
}

interface Mutation {
  binding: Binding;
  loc: SourceLocation;
}

const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  left === right ||
  (left !== GeneratedSource &&
    right !== GeneratedSource &&
    left.start === right.start &&
    left.end === right.end);

/**
 * A function's effects are attached to the instruction that creates it but only happen when
 * it's called, which the evaluator follows separately.
 */
const isFunctionCreation = (value: InstructionValue): boolean =>
  value.kind === "FunctionExpression" || value.kind === "ObjectMethod";

const getMutatedPlace = (effect: AliasingEffect): Place | null => {
  switch (effect.kind) {
    case "Mutate":
    case "MutateTransitive":
      return effect.value;
    case "MutateFrozen":
      return effect.place;
    default:
      return null;
  }
};

export type ModuleFunctionLoader = (name: string) => HIRFunction | null;

type BranchTerminal = Extract<Terminal, { kind: "if" | "branch" }>;

const ROOT_WALK_STATE: WalkState = { guards: [], isAsync: false };

const UNDEFINED_VALUE: SymbolicValue = { kind: "Primitive", value: undefined };

const createUnknown = (reason: string, loc: SourceLocation): SymbolicValue => ({
  kind: "Unknown",
  reason,
  loc,
});

const createBindingValue = (binding: Binding): BindingValue => ({
  kind: "Binding",
  binding,
  path: [],
});

const getIdentifierName = (place: Place): string | null => place.identifier.name?.value ?? null;

const getDeclarationLocation = (place: Place): SourceLocation =>
  place.identifier.loc === GeneratedSource ? place.loc : place.identifier.loc;

const getPlaceOrSpread = (argument: Place | SpreadPattern): Place =>
  argument.kind === "Spread" ? argument.place : argument;

const foldBinary = (operator: string, left: SymbolicValue, right: SymbolicValue): SymbolicValue => {
  if (left.kind !== "Primitive" || right.kind !== "Primitive")
    return { kind: "BinaryExpression", operator, left, right };
  const leftValue = left.value;
  const rightValue = right.value;
  switch (operator) {
    case "===":
      return { kind: "Primitive", value: leftValue === rightValue };
    case "!==":
      return { kind: "Primitive", value: leftValue !== rightValue };
    case "==":
      // oxlint-disable-next-line eqeqeq -- Folds JavaScript loose equality as written.
      return { kind: "Primitive", value: leftValue == rightValue };
    case "!=":
      // oxlint-disable-next-line eqeqeq -- Folds JavaScript loose equality as written.
      return { kind: "Primitive", value: leftValue != rightValue };
    default:
      return { kind: "BinaryExpression", operator, left, right };
  }
};

const getKnownOutcome = (test: SymbolicValue, testKind: TestKind): boolean | null => {
  if (testKind === "truthy") return getKnownTruthiness(test);
  return test.kind === "Primitive" ? test.value !== null && test.value !== undefined : null;
};

const foldUnary = (operator: string, value: SymbolicValue): SymbolicValue => {
  if (operator === "!" && value.kind === "Primitive")
    return { kind: "Primitive", value: !value.value };
  if (operator === "!") return negate(value);
  return { kind: "UnaryExpression", operator, value };
};

const getComponentName = (tag: SymbolicValue): string => {
  if (tag.kind === "Global") return tag.name;
  if (tag.kind === "Binding") return tag.binding.name;
  return "Unknown";
};

const createConditional = (
  split: SplitOutcome,
  consequent: SymbolicValue,
  alternate: SymbolicValue,
): ConditionalValue => ({
  kind: "Conditional",
  test: split.test,
  testKind: split.testKind,
  consequent,
  alternate,
  decision: split.decision,
});

const isFallthroughOnly = (outcome: Outcome, join: BlockId): boolean =>
  outcome.kind === "Split"
    ? isFallthroughOnly(outcome.consequent, join) && isFallthroughOnly(outcome.alternate, join)
    : outcome.kind === "Fallthrough" && outcome.to === join;

const hasFallthrough = (outcome: Outcome, join: BlockId): boolean =>
  outcome.kind === "Split"
    ? hasFallthrough(outcome.consequent, join) || hasFallthrough(outcome.alternate, join)
    : outcome.kind === "Fallthrough" && outcome.to === join;

const NO_STOPS: ReadonlySet<BlockId> = new Set();

const getHookBindingKind = (hookKind: HookKind): BindingKind =>
  hookKind === "useRef" ? "ref" : hookKind === "useContext" ? "context" : "hook";

const isNullishValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && isNullish(value.value);

/**
 * The test under which an optional chain's value short-circuits to `undefined`, or null
 * when it never does. Member accesses past the `?.` are assumed not to throw.
 */
const getShortCircuit = (
  value: SymbolicValue,
): { test: SymbolicValue; testKind: TestKind } | null =>
  value.kind === "Conditional" &&
  value.alternate.kind === "Primitive" &&
  value.alternate.value === undefined
    ? { test: value.test, testKind: value.testKind }
    : null;

const getGuard = (split: SplitOutcome, isConsequent: boolean): SymbolicValue => {
  const test = getTestExpression(split);
  return isConsequent ? test : negate(test);
};

/**
 * Runs HIR symbolically. Values are expressions over bindings instead of runtime values.
 * Where control flow joins, phis become `Conditional` values keyed by the decision that
 * split them, so a component's return value is its render tree with every decision kept.
 *
 * The same walk serves event handlers and effects: in `effect` mode it also collects state
 * updates and prop calls, each with the guards that lead to it.
 */
export class SymbolicEvaluator {
  readonly #resolver: DomainResolver;
  readonly #loadModuleFunction: ModuleFunctionLoader;
  readonly #values = new Map<IdentifierId, SymbolicValue>();
  readonly #propertyNames = new Map<IdentifierId, string>();
  readonly #functions: HIRFunction[] = [];
  readonly #bindings = new Map<string, Binding>();
  readonly #propBindings = new Map<string, Binding>();
  readonly #branchOperators = new Map<BlockId, BranchOperator>();
  readonly placeDomains = new Map<string, Domain>();
  readonly bailouts: Bailout[] = [];
  readonly warnings: Warning[] = [];
  readonly effectCalls: EffectCall[] = [];
  readonly renderedComponents = new Set<string>();
  #mode: EvaluationMode = "render";
  #collected: CollectedEffects = { updates: [], delegates: [] };
  #mutations = new Map<number, Mutation>();
  #currentFunction: HIRFunction | null = null;
  #blockVisits = 0;
  #inlineDepth = 0;

  constructor(resolver: DomainResolver, loadModuleFunction: ModuleFunctionLoader) {
    this.#resolver = resolver;
    this.#loadModuleFunction = loadModuleFunction;
  }

  get bindings(): Binding[] {
    return [...this.#bindings.values()];
  }

  #getFunction(functionId: number): HIRFunction | null {
    return this.#functions[functionId] ?? null;
  }

  #registerFunction(fn: HIRFunction): FunctionValue {
    this.#functions.push(fn);
    return { kind: "Function", functionId: this.#functions.length - 1, loc: fn.loc };
  }

  #getCurrentFunction(): HIRFunction {
    if (!this.#currentFunction) throw new Error("No function is being evaluated");
    return this.#currentFunction;
  }

  #createBinding(
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: Partial<Pick<Binding, "hookKind" | "propName" | "initial" | "inputs">> = {},
  ): Binding {
    const key = `${kind}:${name}:${loc === GeneratedSource ? "generated" : loc.start}`;
    const existing = this.#bindings.get(key);
    if (existing) return existing;
    const binding: Binding = {
      id: this.#bindings.size,
      name: this.#resolver.getSourceName(loc) ?? name,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: this.#resolver.getDomain(loc),
      samples: kind === "prop" ? this.#resolver.getSamples(loc) : [],
      initial: options.initial ?? null,
      inputs: options.inputs ?? [],
    };
    this.#bindings.set(key, binding);
    this.placeDomains.set(getPlaceKey(binding, []), binding.domain);
    return binding;
  }

  #readField(binding: Binding, path: string[], loc: SourceLocation): BindingValue {
    const key = getPlaceKey(binding, path);
    if (!this.placeDomains.has(key)) this.placeDomains.set(key, this.#resolver.getDomain(loc));
    return { kind: "Binding", binding, path };
  }

  #read(place: Place): SymbolicValue {
    return this.#values.get(place.identifier.id) ?? createUnknown("free-variable", place.loc);
  }

  #write(place: Place, value: SymbolicValue): void {
    this.#values.set(place.identifier.id, value);
  }

  #getPropBinding(propName: string, localName: string, loc: SourceLocation): Binding {
    const existing = this.#propBindings.get(propName);
    if (existing) return existing;
    const binding = this.#createBinding(localName, "prop", loc, { propName });
    this.#propBindings.set(propName, binding);
    return binding;
  }

  #bindHookResult(place: Place, hook: HookResultValue): BindingValue {
    return createBindingValue(
      this.#createBinding(
        getIdentifierName(place) ?? hook.name,
        getHookBindingKind(hook.hookKind),
        getDeclarationLocation(place),
        { hookKind: hook.hookKind },
      ),
    );
  }

  #destructure(
    items: Array<Place | null>,
    value: SymbolicValue,
    loc: SourceLocation,
  ): Array<SymbolicValue | null> {
    if (value.kind !== "HookResult") return items.map(() => null);
    const [valuePlace] = items;
    const [firstArgument, secondArgument] = value.args;
    if (STATE_HOOKS.has(value.hookKind) && valuePlace) {
      const initial = firstArgument && firstArgument.kind !== "Function" ? firstArgument : null;
      const binding = this.#createBinding(
        getIdentifierName(valuePlace) ?? "state",
        "state",
        valuePlace.loc,
        { hookKind: value.hookKind, initial },
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
        { kind: "Dispatch", binding, reducer: firstArgument ?? createUnknown("reducer", loc) },
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
        // One hook call is one binding, so fields destructured from it, like `isFirstStep` and
        // `previousStep` from `useWizard()`, stay paths of the same value.
        const binding = this.#createBinding(
          `${value.name}()`,
          getHookBindingKind(value.hookKind),
          instruction.loc,
          { hookKind: value.hookKind },
        );
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
          (object.spreads.length > 0
            ? createUnknown("spread", loc)
            : { kind: "Primitive", value: undefined })
        );
      case "ArrayExpression":
        return property === "length" && object.spreads.length === 0
          ? { kind: "Primitive", value: object.elements.length }
          : createUnknown("member", loc);
      case "Global":
        return { kind: "Global", name: `${object.name}.${property}`, module: object.module };
      case "Conditional":
        // Reading a property of null or undefined throws, so a render that gets past the read
        // took the other arm.
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

  #buildJsx(
    tag: SymbolicValue,
    declaration: string | null,
    props: Array<JsxProp | JsxSpreadProp>,
    children: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue {
    if (tag.kind === "Conditional") {
      return {
        ...tag,
        consequent: this.#buildJsx(tag.consequent, declaration, props, children, loc),
        alternate: this.#buildJsx(tag.alternate, declaration, props, children, loc),
      };
    }
    const jsxTag: JsxTag =
      tag.kind === "Primitive" && typeof tag.value === "string"
        ? { kind: "BuiltinTag", name: tag.value }
        : { kind: "Component", name: getComponentName(tag), declaration };
    if (jsxTag.kind === "Component") this.renderedComponents.add(jsxTag.name);
    return { kind: "JsxExpression", tag: jsxTag, props, children, loc };
  }

  #callFunction(
    callee: FunctionValue,
    args: SymbolicValue[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const fn = this.#getFunction(callee.functionId);
    if (!fn || this.#inlineDepth >= MAX_INLINE_DEPTH) return createUnknown("call", loc);
    this.#inlineDepth++;
    try {
      return this.#evaluateFunction(fn, args, state);
    } finally {
      this.#inlineDepth--;
    }
  }

  /**
   * Records a bailout once per reason and location, however often the evaluator revisits it.
   */
  #bailOut(reason: BailoutReason, message: string, loc: SourceLocation): void {
    const isDuplicate = this.bailouts.some(
      (bailout) => bailout.reason === reason && isSameLocation(bailout.loc, loc),
    );
    if (!isDuplicate) this.bailouts.push({ reason, message, loc });
  }

  #warn(kind: WarningKind, message: string, loc: SourceLocation): void {
    const isDuplicate = this.warnings.some(
      (warning) => warning.kind === kind && warning.message === message,
    );
    if (!isDuplicate) this.warnings.push({ kind, message, loc });
  }

  /**
   * Records state and props the compiler's effects prove an instruction mutates. In a
   * handler, later reads of mutated state no longer match what was rendered.
   */
  #trackMutations(instruction: Instruction): void {
    if (isFunctionCreation(instruction.value)) return;
    for (const effect of instruction.effects ?? []) {
      const place = getMutatedPlace(effect);
      if (!place) continue;
      const operand = this.#read(place);
      if (operand.kind !== "Binding") continue;
      const { binding } = operand;
      if (binding.kind === "prop") {
        this.#warn(
          "prop-mutation",
          `mutates prop ${formatPlace(binding, operand.path)}`,
          place.loc,
        );
      } else if (isStateBinding(binding)) {
        if (this.#mode === "render") {
          this.#warn("render-mutation", `mutates ${binding.name} during render`, place.loc);
        } else if (!this.#mutations.has(binding.id)) {
          this.#mutations.set(binding.id, { binding, loc: place.loc });
        }
      }
    }
  }

  #forgetMutations(value: SymbolicValue): SymbolicValue {
    return mapSymbolicValue(value, (part) =>
      part.kind === "Binding" && this.#mutations.has(part.binding.id)
        ? createUnknown("mutated", GeneratedSource)
        : part,
    );
  }

  #recordUpdate(binding: Binding, value: SymbolicValue, state: WalkState): void {
    if (this.#mode !== "effect") return;
    const mutation = this.#mutations.get(binding.id);
    if (mutation) {
      const isSameReference = isWholeBinding(value, binding);
      this.#warn(
        isSameReference ? "lost-update" : "state-mutation",
        isSameReference
          ? `sets ${binding.name} to the array or object it mutated, so React skips the update`
          : `mutates ${binding.name} in place before setting it`,
        mutation.loc,
      );
    }
    const knownValue = this.#forgetMutations(value);
    this.#collected.updates.push({
      binding,
      value:
        state.isAsync && knownValue.kind !== "Primitive"
          ? createUnknown("async", GeneratedSource)
          : knownValue,
      guards: state.guards,
      isAsync: state.isAsync,
    });
  }

  #applySetter(setter: SetterValue, argument: SymbolicValue | undefined, state: WalkState): void {
    const next =
      argument?.kind === "Function"
        ? this.#callFunction(
            argument,
            [createBindingValue(setter.binding)],
            setter.binding.loc,
            state,
          )
        : (argument ?? UNDEFINED_VALUE);
    this.#recordUpdate(setter.binding, next, state);
  }

  #applyDispatch(
    dispatch: DispatchValue,
    action: SymbolicValue | undefined,
    loc: SourceLocation,
    state: WalkState,
  ): void {
    let reducer = dispatch.reducer;
    if (reducer.kind === "Global") {
      const moduleFunction = this.#loadModuleFunction(reducer.name);
      reducer = moduleFunction ? this.#registerFunction(moduleFunction) : reducer;
    }
    const next =
      reducer.kind === "Function"
        ? this.#callFunction(
            reducer,
            [createBindingValue(dispatch.binding), action ?? UNDEFINED_VALUE],
            loc,
            state,
          )
        : createUnknown("dispatch", loc);
    this.#recordUpdate(dispatch.binding, next, state);
  }

  #evaluateCall(
    callee: SymbolicValue,
    calleePlace: Place,
    args: SymbolicValue[],
    argumentPlaces: Place[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const hookKind = getHookKind(this.#getCurrentFunction().env, calleePlace.identifier);
    if (hookKind !== null)
      return this.#evaluateHookCall(hookKind, callee, args, argumentPlaces, loc, state);
    switch (callee.kind) {
      case "Function":
        return this.#callFunction(callee, args, loc, state);
      case "Setter":
        this.#applySetter(callee, args[0], state);
        return UNDEFINED_VALUE;
      case "Dispatch":
        this.#applyDispatch(callee, args[0], loc, state);
        return UNDEFINED_VALUE;
      case "Binding":
        if (this.#mode !== "effect") break;
        if (callee.binding.kind === "prop")
          this.#collected.delegates.push(formatPlace(callee.binding, callee.path));
        if (isExternalSource(callee.binding)) this.#recordExternalUpdate(callee, state);
        break;
      default:
        break;
    }
    for (const argument of args) this.#visitCallbackArgument(argument, state);
    if (this.#mode !== "render") return createUnknown("call", loc);
    if (this.#resolver.isReactElement(loc)) {
      this.#bailOut("unknown-call", "call returns JSX the analysis can't see into", loc);
      return createUnknown("call", loc);
    }
    return this.#createCallResult(args, loc);
  }

  /**
   * Gives a call the analysis can't see into a value of its return type. When the type has
   * a finite set of values, like `boolean`, the result is a binding states can split on.
   * The same call with different arguments, like a helper called twice, is a different
   * binding.
   */
  #createCallResult(args: SymbolicValue[], loc: SourceLocation): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(loc);
    if (calleeText === null || this.#resolver.getDomain(loc).kind !== "Cases") {
      return createUnknown("call", loc);
    }
    const name = `${calleeText}(${args.map(formatSymbolicValue).join(", ")})`;
    const inputs = new Set<string>();
    for (const argument of args)
      forEachSymbolicValue(argument, (part) => {
        if (part.kind === "Binding") inputs.add(getBindingPlaceKey(part));
      });
    return createBindingValue(this.#createBinding(name, "call", loc, { inputs: [...inputs] }));
  }

  #visitCallbackArgument(argument: SymbolicValue, state: WalkState): void {
    if (this.#mode !== "effect") return;
    const asyncState = { ...state, isAsync: true };
    if (argument.kind === "Setter")
      this.#recordUpdate(
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
        this.effectCalls.push({ hookKind, callback, dependencies: dependencies?.loc ?? null, loc });
      return UNDEFINED_VALUE;
    }
    if (hookKind === "useMemo" && args[0]?.kind === "Function")
      return this.#callFunction(args[0], [], loc, state);
    if (hookKind === "useCallback" && args[0]) return args[0];
    const name = callee.kind === "Global" ? callee.name : hookKind;
    return { kind: "HookResult", hookKind, name, args };
  }

  #evaluateMethodCall(
    instruction: Extract<InstructionValue, { kind: "MethodCall" }>,
    state: WalkState,
  ): SymbolicValue {
    const receiver = this.#read(instruction.receiver);
    const propertyName = this.#propertyNames.get(instruction.property.identifier.id) ?? null;
    const argumentPlaces = instruction.args.map(getPlaceOrSpread);
    const args = argumentPlaces.map((place) => this.#read(place));
    const [callback] = args;
    if (propertyName === "map" && callback?.kind === "Function") {
      const parameter = this.#getFunction(callback.functionId)?.params[0];
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
      this.#propertyNames.set(instruction.lvalue.identifier.id, String(value.property));
    this.#trackMutations(instruction);
    this.#write(instruction.lvalue, this.#evaluateInstructionValue(value, state));
  }

  #evaluateInstructionValue(value: InstructionValue, state: WalkState): SymbolicValue {
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
      case "TypeCastExpression":
        return this.#read(value.value);
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
        return this.#registerFunction(value.loweredFunc.func);
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
                transitionId: null,
              }
            : {
                kind: "JsxSpreadAttribute",
                value: this.#read(attribute.argument),
                transitionId: null,
              },
        );
        return this.#buildJsx(
          this.#getJsxTag(value.tag),
          value.tag.kind === "BuiltinTag" ? null : this.#resolver.getDeclarationKey(value.tag.loc),
          props,
          (value.children ?? []).map((child) => this.#read(child)),
          value.loc,
        );
      }
      case "JsxFragment":
        return { kind: "JsxFragment", children: value.children.map((child) => this.#read(child)) };
      case "Await":
        return createUnknown("async", value.loc);
      case "NewExpression":
      case "TemplateLiteral":
      case "TaggedTemplateExpression":
      case "RegExpLiteral":
      case "MetaProperty":
      case "GetIterator":
      case "IteratorNext":
      case "NextPropertyOf":
      case "PropertyStore":
      case "ComputedStore":
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

  #resolvePhi(phi: Phi, outcome: Outcome): SymbolicValue {
    switch (outcome.kind) {
      case "Fallthrough": {
        const operand = outcome.from === null ? undefined : phi.operands.get(outcome.from);
        return operand ? this.#read(operand) : createUnknown("loop", phi.place.loc);
      }
      case "Split":
        return createConditional(
          outcome,
          this.#resolvePhi(phi, outcome.consequent),
          this.#resolvePhi(phi, outcome.alternate),
        );
      case "Return":
        return createUnknown("unreachable", phi.place.loc);
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  /**
   * Continues past a join. When every path reaches the join, phis merge into conditionals
   * and the rest is walked once. When some paths returned or left for an enclosing join,
   * the rest is walked separately for each path that reaches this join, with its guards.
   * A join an enclosing walk stops at is left for that walk to merge.
   */
  #continueAfter(
    outcome: Outcome,
    join: BlockId,
    stops: ReadonlySet<BlockId>,
    state: WalkState,
  ): Outcome {
    if (stops.has(join)) return outcome;
    const block = this.#getBlock(join);
    if (isFallthroughOnly(outcome, join)) {
      for (const phi of block.phis) this.#write(phi.place, this.#resolvePhi(phi, outcome));
      return this.#walk(join, stops, null, state, true);
    }
    const resume = (current: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (current.kind) {
        case "Return":
          return current;
        case "Fallthrough":
          return current.to === join
            ? this.#walk(join, stops, current.from, { ...state, guards }, false)
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
    const operator = this.#branchOperators.get(fallthrough) ?? "ternary";
    const chainValue = this.#read(test);
    const shortCircuit = operator === "chain" ? getShortCircuit(chainValue) : null;
    const testValue = shortCircuit?.test ?? chainValue;
    const testKind: TestKind =
      shortCircuit?.testKind ??
      (operator === "??" || operator === "optional" || operator === "chain" ? "nullish" : "truthy");
    const decision: Decision = {
      terminalId: terminal.id,
      probe: this.#resolver.isExpression(test.loc) ? testKind : "none",
      loc: test.loc,
    };
    const testGuard = getTestExpression({ test: testValue, testKind });
    const walkArm = (block: BlockId, isConsequent: boolean): Outcome => {
      const guards = [...state.guards, isConsequent ? testGuard : negate(testGuard)];
      return block === fallthrough
        ? { kind: "Fallthrough", from, to: fallthrough }
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
            decision,
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
        decision: { terminalId: terminal.id, probe: "none", loc: switchCase.test.loc },
        consequent: caseOutcome,
        alternate: buildCases(index + 1),
      };
    };
    return this.#continueAfter(buildCases(0), terminal.fallthrough, stops, state);
  }

  /**
   * Walks blocks from `blockId` until a return, or until control reaches one of `stops`.
   */
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
      if (++this.#blockVisits > MAX_BLOCK_VISITS)
        return { kind: "Return", value: createUnknown("too-complex", GeneratedSource) };
      const block = this.#getBlock(currentId);
      if (!isPhiResolved) {
        for (const phi of block.phis)
          this.#write(
            phi.place,
            this.#resolvePhi(phi, { kind: "Fallthrough", from: previousId, to: currentId }),
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
          this.#branchOperators.set(
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
          nextId = terminal.block;
          break;
        case "maybe-throw":
          nextId = terminal.continuation;
          break;
        case "for":
        case "for-of":
        case "for-in":
        case "while":
        case "do-while":
          this.#bailOut("loop", "values assigned in a loop are not modeled", terminal.loc);
          nextId = terminal.fallthrough;
          nextFrom = null;
          break;
        default:
          return assertExhaustive(terminal, "Unhandled terminal");
      }
      previousId = nextFrom;
      currentId = nextId;
      isPhiResolved = false;
    }
  }

  #toValue(outcome: Outcome, loc: SourceLocation): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return createConditional(
          outcome,
          this.#toValue(outcome.consequent, loc),
          this.#toValue(outcome.alternate, loc),
        );
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #evaluateFunction(fn: HIRFunction, args: SymbolicValue[], state: WalkState): SymbolicValue {
    const previousFunction = this.#currentFunction;
    this.#currentFunction = fn;
    try {
      fn.params.forEach((parameter, index) => {
        const place = getPlaceOrSpread(parameter);
        this.#write(
          place,
          parameter.kind === "Spread"
            ? createUnknown("rest", place.loc)
            : (args[index] ?? UNDEFINED_VALUE),
        );
      });
      return this.#toValue(this.#walk(fn.body.entry, NO_STOPS, null, state, false), fn.loc);
    } finally {
      this.#currentFunction = previousFunction;
    }
  }

  /**
   * Evaluates a component in render mode: its first parameter is the props object.
   */
  evaluateComponent(fn: HIRFunction): SymbolicValue {
    return this.#evaluateFunction(fn, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  /**
   * A handler that calls into a custom hook's result or a context value, like
   * `query.refetch()` or `auth.logout()`, can change what that source returns. When and to
   * what is unknown, so the source changes to anything, asynchronously.
   */
  #recordExternalUpdate(callee: BindingValue, state: WalkState): void {
    this.#collected.delegates.push(formatPlace(callee.binding, callee.path));
    if (this.#collected.updates.some((update) => update.binding.id === callee.binding.id)) return;
    this.#collected.updates.push({
      binding: callee.binding,
      value: createUnknown("external", GeneratedSource),
      guards: state.guards,
      isAsync: true,
    });
  }

  /**
   * State a handler mutates but never sets still changes: React shows the new contents the
   * next time anything re-renders. The state is forgotten so later states stay sound.
   */
  #recordUnsetMutations(): void {
    for (const { binding, loc } of this.#mutations.values()) {
      if (this.#collected.updates.some((update) => update.binding.id === binding.id)) continue;
      this.#warn(
        "state-mutation",
        `mutates ${binding.name} without setting it, so the change shows only on the next render`,
        loc,
      );
      this.#collected.updates.push({
        binding,
        value: createUnknown("mutated", GeneratedSource),
        guards: [],
        isAsync: false,
      });
    }
  }

  /**
   * Evaluates an event handler or effect callback and returns the state updates and prop
   * calls it makes.
   */
  collectEffects(callback: SymbolicValue, args: SymbolicValue[]): CollectedEffects {
    const previousMode = this.#mode;
    const previousCollected = this.#collected;
    const previousMutations = this.#mutations;
    this.#mode = "effect";
    this.#collected = { updates: [], delegates: [] };
    this.#mutations = new Map();
    try {
      if (callback.kind === "Function") {
        const fn = this.#getFunction(callback.functionId);
        if (fn) this.#evaluateFunction(fn, args, ROOT_WALK_STATE);
      }
      if (callback.kind === "Setter")
        this.#recordUpdate(
          callback.binding,
          createUnknown("event", GeneratedSource),
          ROOT_WALK_STATE,
        );
      if (callback.kind === "Binding" && callback.binding.kind === "prop")
        this.#collected.delegates.push(callback.binding.name);
      if (callback.kind === "Binding" && isExternalSource(callback.binding))
        this.#recordExternalUpdate(callback, ROOT_WALK_STATE);
      if (callback.kind === "Unknown")
        for (const binding of this.#bindings.values())
          if (isExternalSource(binding))
            this.#recordExternalUpdate(createBindingValue(binding), ROOT_WALK_STATE);
      this.#recordUnsetMutations();
      return this.#collected;
    } finally {
      this.#mode = previousMode;
      this.#collected = previousCollected;
      this.#mutations = previousMutations;
    }
  }
}
