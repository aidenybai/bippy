import type { AliasingEffect } from "../react-compiler/Inference/AliasingEffects.js";
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
  SpreadPattern,
  Terminal,
} from "../react-compiler/HIR/HIR.js";
import { GeneratedSource, getHookKind } from "../react-compiler/HIR/HIR.js";
import type { HookKind } from "../react-compiler/HIR/ObjectShape.js";
import { assertExhaustive } from "../react-compiler/Utils/utils.js";
import type { DomainResolver } from "./infer-domains.js";
import type {
  Bailout,
  BailoutReason,
  Binding,
  BindingKind,
  BindingValue,
  ConditionalValue,
  ContextModels,
  Branch,
  DispatchValue,
  Domain,
  FunctionValue,
  HookResultValue,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  ProvidedContext,
  Sample,
  StoreAssignment,
  StoreModel,
  SetterValue,
  StateUpdate,
  SymbolicValue,
  TestKind,
  Warning,
  WarningKind,
} from "./types.js";
import { formatPlace, formatSymbolicValue } from "./format.js";
import { forEachSymbolicValue, mapSymbolicValue } from "./utils/traverse.js";
import { getBindingPlaceKey, getPlaceKey } from "./utils/place-key.js";
import { isExternalSource, isNullish, isStateBinding, isWholeBinding } from "./utils/checks.js";
import { getKnownTruthiness, getTestExpression, negate } from "./utils/truthiness.js";

const MAX_BLOCK_VISITS = 20_000;
const MAX_INLINE_DEPTH = 4;
const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic", "useActionState"]);
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const SUSPENSE_TAG_PATTERN = /(^|\.)Suspense$/;
const DYNAMIC_TAG_NAME = "Dynamic";
const isDefinedSample = (sample: Sample): boolean =>
  sample.kind !== "Undefined" && !(sample.kind === "Value" && sample.value === null);
/** A state initialized from a value the program only asserts the type of, which can be anything. */
const ASSERTED_DOMAIN: Domain = { kind: "Unknown", reason: "cast" };
const SUSPENDED_DOMAIN: Domain = {
  kind: "Cases",
  cases: [
    { kind: "Literal", value: true },
    { kind: "Literal", value: false },
  ],
  origin: "type",
};

/**
 * How a region of the control-flow graph ended: by returning, by falling through from
 * `from` to `to`, one of the joins the walk stops at, or by splitting on a branch into
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
  branch: Branch;
  consequent: Outcome;
  alternate: Outcome;
}

/**
 * `chain` is the non-optional part of an optional chain, like `.c()` in `a?.b.c()`. Its
 * branch only asks whether the chain before it short-circuited.
 */
type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional" | "chain";

type EvaluationMode = "render" | "effect";

/** How to create a binding, and the resolver for the file its location is in. */
interface BindingOptions extends Partial<
  Pick<Binding, "hookKind" | "propName" | "initial" | "inputs" | "domain">
> {
  resolver?: DomainResolver;
}

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
    left.start.index === right.start.index &&
    left.end.index === right.end.index);

/**
 * A function's effects are attached to the instruction that creates it but only happen when
 * it's called, which the interpreter follows separately.
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

/** A custom hook of the project, with the resolver for the file it is declared in. */
export interface ProjectHook {
  fn: HIRFunction;
  resolver: DomainResolver;
}

/** Finds a project hook by its declaration key, like `src/hooks/use-toggle.ts#useToggle`. */
export type ProjectHookLoader = (declarationKey: string) => ProjectHook | null;

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

const isPropsValue = (value: SymbolicValue): boolean => value.kind === "Props";

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

const isSuspenseTag = (tag: SymbolicValue): boolean =>
  tag.kind === "Global" && tag.module === "react" && SUSPENSE_TAG_PATTERN.test(tag.name);

const getComponentName = (tag: Extract<SymbolicValue, { kind: "Global" | "Binding" }>): string =>
  tag.kind === "Global" ? tag.name : tag.binding.name;

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
  branch: split.branch,
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
 * Where control flow joins, phis become `Conditional` values keyed by the branch that
 * split them, so a component's return value is its render tree with every branch kept.
 *
 * The same walk serves event handlers and effects: in `effect` mode it also collects state
 * updates and prop calls, each with the guards that lead to it.
 */
export class Interpreter {
  #resolver: DomainResolver;
  readonly #loadModuleFunction: ModuleFunctionLoader;
  readonly #loadProjectHook: ProjectHookLoader;
  readonly #values = new WeakMap<object, Map<IdentifierId, SymbolicValue>>();
  readonly #functionResolvers = new WeakMap<HIRFunction, DomainResolver>();
  readonly #contextModels: ContextModels;
  readonly #contextKeys = new WeakMap<HookResultValue, string>();
  readonly #hookResolvers = new WeakMap<HookResultValue, DomainResolver>();
  readonly #storeModels: Map<string, StoreModel>;
  readonly #storeBindings = new Map<string, Binding>();
  readonly #storeActions = new Map<number, StoreModel>();
  readonly #contextSetters = new Map<number, Map<string, string>>();
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
  /** The guards each branch's value was computed under, as formatted keys. */
  readonly branchGuards = new WeakMap<ConditionalValue, string[]>();
  /**
   * A sample of the whole props object, once the component passes it on whole, like
   * `templateCtx(props)`, and so reads props that no binding names.
   */
  propsSample: Sample | null = null;
  readonly providedContexts: ProvidedContext[] = [];
  /**
   * A sample of the value each context the component reads holds, by the context's
   * declaration key, which a test mounts the context's provider with.
   */
  readonly contextSamples = new Map<string, Sample>();
  #mode: EvaluationMode = "render";
  #collected: CollectedEffects = { updates: [], delegates: [] };
  #mutations = new Map<number, Mutation>();
  #currentFunction: HIRFunction | null = null;
  #blockVisits = 0;
  #inlineDepth = 0;

  constructor(
    resolver: DomainResolver,
    loadModuleFunction: ModuleFunctionLoader,
    loadProjectHook: ProjectHookLoader,
    contextModels: ContextModels,
    storeModels: Map<string, StoreModel>,
  ) {
    this.#resolver = resolver;
    this.#loadModuleFunction = loadModuleFunction;
    this.#loadProjectHook = loadProjectHook;
    this.#contextModels = contextModels;
    this.#storeModels = storeModels;
  }

  get bindings(): Binding[] {
    return [...this.#bindings.values()];
  }

  #getFunction(functionId: number): HIRFunction | null {
    return this.#functions[functionId] ?? null;
  }

  #registerFunction(fn: HIRFunction): FunctionValue {
    if (!this.#functionResolvers.has(fn)) this.#functionResolvers.set(fn, this.#resolver);
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
    options: BindingOptions = {},
  ): Binding {
    const resolver = options.resolver ?? this.#resolver;
    const position = loc === GeneratedSource ? "generated" : loc.start.index;
    const key = `${kind}:${name}:${resolver.fileName}:${position}`;
    const existing = this.#bindings.get(key);
    if (existing) return existing;
    const binding: Binding = {
      id: this.#bindings.size,
      name: resolver.getSourceName(loc) ?? name,
      kind,
      hookKind: options.hookKind ?? null,
      propName: options.propName ?? null,
      loc,
      domain: options.domain ?? resolver.getDomain(loc),
      samples: kind === "prop" ? resolver.getSamples(loc) : [],
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

  /**
   * The values of the current function's identifiers. A function compiled on its own, like
   * a hook from another file, numbers its identifiers from zero too, so each compilation
   * keeps its own.
   */
  #getValues(): Map<IdentifierId, SymbolicValue> {
    const { env } = this.#getCurrentFunction();
    const values = this.#values.get(env) ?? new Map<IdentifierId, SymbolicValue>();
    this.#values.set(env, values);
    return values;
  }

  #read(place: Place): SymbolicValue {
    return this.#getValues().get(place.identifier.id) ?? createUnknown("free-variable", place.loc);
  }

  #write(place: Place, value: SymbolicValue): void {
    this.#getValues().set(place.identifier.id, value);
  }

  #getPropBinding(propName: string, localName: string, loc: SourceLocation): Binding {
    const existing = this.#propBindings.get(propName);
    if (existing) return existing;
    const binding = this.#createBinding(localName, "prop", loc, { propName });
    this.#propBindings.set(propName, binding);
    return binding;
  }

  #bindHookResult(place: Place, hook: HookResultValue): BindingValue {
    const binding = this.#createBinding(
      getIdentifierName(place) ?? hook.name,
      getHookBindingKind(hook.hookKind),
      getDeclarationLocation(place),
      { hookKind: hook.hookKind },
    );
    this.#linkContext(binding, hook);
    return createBindingValue(binding);
  }

  /**
   * Links a context binding to what its providers put in the context, so a handler that
   * calls one of its setters, like `setOpen(true)`, sets the field it pairs with.
   */
  #linkContext(binding: Binding, hook: HookResultValue): void {
    const contextKey = this.#contextKeys.get(hook);
    if (!contextKey) return;
    const setters = this.#contextModels.get(contextKey);
    if (setters) this.#contextSetters.set(binding.id, setters);
    const resolver = this.#hookResolvers.get(hook) ?? this.#resolver;
    const sample = resolver.getSamples(binding.loc).find(isDefinedSample);
    if (sample && !this.contextSamples.has(contextKey)) this.contextSamples.set(contextKey, sample);
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
        if (value.kind === "Props" && this.propsSample === null)
          this.propsSample = this.#resolver.getRequiredSample(property.place.loc);
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
          value.loc,
          { hookKind: value.hookKind, resolver: this.#hookResolvers.get(value) },
        );
        this.#linkContext(binding, value);
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
        : tag.kind === "Global" || tag.kind === "Binding"
          ? { kind: "Component", name: getComponentName(tag), declaration }
          : { kind: "DynamicTag", name: DYNAMIC_TAG_NAME };
    if (jsxTag.kind === "Component") this.renderedComponents.add(jsxTag.name);
    return { kind: "JsxExpression", tag: jsxTag, props, children, loc };
  }

  /**
   * A `Suspense` boundary renders its fallback while anything inside it suspends, which the
   * render can't decide, so it branches on whether it is suspended.
   */
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
    };
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
   * Records a bailout once per reason and location, however often the interpreter revisits it.
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
    if (!isDuplicate) this.warnings.push({ kind, message, loc, file: this.#resolver.fileName });
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
    const propsPlace = argumentPlaces[args.findIndex(isPropsValue)];
    if (this.propsSample === null && propsPlace)
      this.propsSample = this.#resolver.getSamples(propsPlace.loc)[0] ?? null;
    const hookKind = getHookKind(this.#getCurrentFunction().env, calleePlace.identifier);
    const projectHook = hookKind === "Custom" ? this.#findProjectHook(calleePlace) : null;
    if (projectHook && this.#inlineDepth < MAX_INLINE_DEPTH) {
      this.#functionResolvers.set(projectHook.fn, projectHook.resolver);
      return this.#callFunction(this.#registerFunction(projectHook.fn), args, loc, state);
    }
    const storeKey =
      hookKind === "Custom" && !projectHook
        ? this.#resolver.getDeclarationKey(calleePlace.loc)
        : null;
    const storeModel = storeKey ? this.#storeModels.get(storeKey) : undefined;
    if (storeKey && storeModel)
      return this.#readStore(storeKey, storeModel, callee, args, loc, state);
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
        if (this.#mode === "effect" && !this.#resolver.isPureMethod(calleePlace.loc))
          this.#callBinding(callee, args, state);
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
   * The places a value reads, through the places a callback captures, like `query` in
   * `locales.filter((locale) => matches(locale, query))`.
   */
  #collectInputs(value: SymbolicValue, inputs: Set<string>): void {
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") inputs.add(getBindingPlaceKey(part));
      if (part.kind !== "Function") return;
      for (const place of this.#getFunction(part.functionId)?.context ?? [])
        this.#collectInputs(this.#read(place), inputs);
    });
  }

  /**
   * Gives a call the analysis can't see into a value of its return type. When the type has
   * a finite set of values, like `boolean`, or the arguments read the component's data, the
   * result is a binding that changes with them and that states can split on. The same call
   * with different arguments, like a helper called twice, is a different binding.
   */
  #createCallResult(args: SymbolicValue[], loc: SourceLocation): SymbolicValue {
    const calleeText = this.#resolver.getCalleeText(loc);
    if (calleeText === null) return createUnknown("call", loc);
    const inputs = new Set<string>();
    for (const argument of args) this.#collectInputs(argument, inputs);
    if (inputs.size === 0 && this.#resolver.getDomain(loc).kind !== "Cases")
      return createUnknown("call", loc);
    const name = `${calleeText}(${args.map(formatSymbolicValue).join(", ")})`;
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
    const hookResult: HookResultValue = { kind: "HookResult", hookKind, name, args, loc };
    const [contextPlace] = argumentPlaces;
    const contextKey =
      hookKind === "useContext" && contextPlace
        ? this.#resolver.getDeclarationKey(contextPlace.loc)
        : null;
    if (contextKey) this.#contextKeys.set(hookResult, contextKey);
    this.#hookResolvers.set(hookResult, this.#resolver);
    return hookResult;
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
    this.#write(instruction.lvalue, this.#evaluateInstructionValue(instruction, state));
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
        const element = this.#buildJsx(
          tag,
          value.tag.kind === "BuiltinTag" ? null : this.#resolver.getDeclarationKey(value.tag.loc),
          props,
          (value.children ?? []).map((child) => this.#read(child)),
          value.loc,
        );
        return isSuspenseTag(tag) && element.kind === "JsxExpression"
          ? this.#buildSuspense(element, instruction.id)
          : element;
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

  #createConditional(
    split: SplitOutcome,
    guards: SymbolicValue[],
    toArm: (arm: Outcome, armGuards: SymbolicValue[]) => SymbolicValue,
  ): ConditionalValue {
    const conditional = createConditional(
      split,
      toArm(split.consequent, [...guards, getGuard(split, true)]),
      toArm(split.alternate, [...guards, getGuard(split, false)]),
    );
    this.branchGuards.set(conditional, guards.map(formatSymbolicValue));
    return conditional;
  }

  #resolvePhi(phi: Phi, outcome: Outcome, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Fallthrough": {
        const operand = outcome.from === null ? undefined : phi.operands.get(outcome.from);
        return operand ? this.#read(operand) : createUnknown("loop", phi.place.loc);
      }
      case "Split":
        return this.#createConditional(outcome, guards, (arm, armGuards) =>
          this.#resolvePhi(phi, arm, armGuards),
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
    const branch: Branch = {
      terminalId: terminal.id,
      probe: this.#resolver.isExpression(test.loc) ? testKind : "none",
      loc: test.loc,
      file: this.#resolver.fileName,
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
        case "scope":
        case "pruned-scope":
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

  #toValue(outcome: Outcome, loc: SourceLocation, guards: SymbolicValue[]): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return createUnknown("fallthrough", loc);
      case "Split":
        return this.#createConditional(outcome, guards, (arm, armGuards) =>
          this.#toValue(arm, loc, armGuards),
        );
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  /**
   * Reads a zustand store, like `useConfig((state) => state.darkmodeEnabled)`. Every read
   * of one store is a field of one binding, so an action called through any of them, like
   * `toggleDarkMode(true)`, sets the fields the store's model says it does.
   */
  #readStore(
    storeKey: string,
    model: StoreModel,
    callee: SymbolicValue,
    args: SymbolicValue[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const name = callee.kind === "Global" ? callee.name : "store";
    const binding =
      this.#storeBindings.get(storeKey) ??
      this.#createBinding(`${name}()`, "hook", loc, {
        hookKind: "Custom",
        domain: { kind: "Opaque", typeText: name },
      });
    this.#storeBindings.set(storeKey, binding);
    this.#storeActions.set(binding.id, model);
    const [selector] = args;
    return selector?.kind === "Function"
      ? this.#callFunction(selector, [createBindingValue(binding)], loc, state)
      : createBindingValue(binding);
  }

  /** The value a store action gives a field, from the arguments it was called with. */
  #getStoreFieldValue(
    binding: Binding,
    { field, value }: StoreAssignment,
    args: SymbolicValue[],
  ): SymbolicValue {
    switch (value.kind) {
      case "Argument":
        return args[value.index] ?? UNDEFINED_VALUE;
      case "Literal":
        return { kind: "Primitive", value: value.value };
      case "Toggle":
        return {
          kind: "UnaryExpression",
          operator: "!",
          value: { kind: "Binding", binding, path: [field] },
        };
      case "Unknown":
        return createUnknown("store", binding.loc);
      default:
        return assertExhaustive(value, "Unhandled store field value");
    }
  }

  /**
   * The project's own hook a call reaches, which runs inline as part of the component, so
   * its state is the component's state and the functions it returns are known.
   */
  #findProjectHook(calleePlace: Place): ProjectHook | null {
    const declarationKey = this.#resolver.getDeclarationKey(calleePlace.loc);
    return declarationKey ? this.#loadProjectHook(declarationKey) : null;
  }

  #evaluateFunction(fn: HIRFunction, args: SymbolicValue[], state: WalkState): SymbolicValue {
    const previousFunction = this.#currentFunction;
    const previousResolver = this.#resolver;
    this.#currentFunction = fn;
    this.#resolver = this.#functionResolvers.get(fn) ?? previousResolver;
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
      return this.#toValue(
        this.#walk(fn.body.entry, NO_STOPS, null, state, false),
        fn.loc,
        state.guards,
      );
    } finally {
      this.#currentFunction = previousFunction;
      this.#resolver = previousResolver;
    }
  }

  /**
   * Evaluates a component in render mode: its first parameter is the props object.
   */
  evaluateComponent(fn: HIRFunction): SymbolicValue {
    return this.#evaluateFunction(fn, [{ kind: "Props" }], ROOT_WALK_STATE);
  }

  /**
   * Calls a function held in a binding: a prop the parent handles, or a hook or context
   * function that may change that source.
   */
  #callBinding(callee: BindingValue, args: SymbolicValue[], state: WalkState): void {
    if (callee.binding.kind === "prop")
      this.#collected.delegates.push(formatPlace(callee.binding, callee.path));
    const [setterField] = callee.path;
    const field =
      callee.path.length === 1 && setterField
        ? this.#contextSetters.get(callee.binding.id)?.get(setterField)
        : undefined;
    const assignments =
      callee.path.length === 1 && setterField
        ? this.#storeActions.get(callee.binding.id)?.get(setterField)
        : undefined;
    if (field) this.#setContextField(callee.binding, field, args[0], state);
    else if (assignments)
      this.#recordUpdate(
        callee.binding,
        {
          kind: "ObjectExpression",
          properties: assignments.map((assignment) => ({
            key: assignment.field,
            value: this.#getStoreFieldValue(callee.binding, assignment, args),
          })),
          spreads: [createBindingValue(callee.binding)],
        },
        state,
      );
    else if (isExternalSource(callee.binding)) this.#recordExternalUpdate(callee, state);
  }

  /**
   * Sets a field of a context through the setter its provider pairs with it. Whether a
   * provider is mounted above isn't known here, and a context's default value often has
   * setters that do nothing, so the update is async: it may not happen. The value is still
   * the one the handler computed, unlike a callback's that runs later.
   */
  #setContextField(
    binding: Binding,
    field: string,
    argument: SymbolicValue | undefined,
    state: WalkState,
  ): void {
    const next =
      argument?.kind === "Function"
        ? this.#callFunction(
            argument,
            [{ kind: "Binding", binding, path: [field] }],
            binding.loc,
            state,
          )
        : (argument ?? UNDEFINED_VALUE);
    if (this.#mode !== "effect") return;
    this.#collected.updates.push({
      binding,
      value: {
        kind: "ObjectExpression",
        properties: [{ key: field, value: this.#forgetMutations(next) }],
        spreads: [createBindingValue(binding)],
      },
      guards: state.guards,
      isAsync: true,
    });
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
      if (callback.kind === "Binding") this.#callBinding(callback, args, ROOT_WALK_STATE);
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
