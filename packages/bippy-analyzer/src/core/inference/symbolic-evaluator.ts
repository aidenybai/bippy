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
} from "../hir/hir.js";
import { GeneratedSource, getHookKind } from "../hir/hir.js";
import type { HookKind } from "../hir/object-shape.js";
import { assertExhaustive } from "../utils/utils.js";
import type { DomainResolver } from "./infer-domains.js";
import type {
  Bailout,
  Binding,
  BindingKind,
  Decision,
  Domain,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  StateUpdate,
  SymbolicValue,
} from "./types.js";
import { getPlaceKey, negate } from "./values.js";

const MAX_BLOCK_VISITS = 20_000;
const MAX_INLINE_DEPTH = 4;
const RENDERABLE_RETURN_TYPE_PATTERN = /Element|ReactNode|ReactPortal|JSX/;
const STATE_HOOKS = new Set<HookKind>(["useState", "useOptimistic", "useActionState"]);
const EFFECT_HOOKS = new Set<HookKind>(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const PROMISE_METHODS = new Set(["then", "catch", "finally"]);

/**
 * How a region of the control-flow graph ended: by returning, by falling through to the
 * block the caller is waiting for, or by splitting on a decision into two outcomes.
 */
type Outcome =
  | { kind: "Return"; value: SymbolicValue }
  | { kind: "Fallthrough"; from: BlockId | null }
  | {
      kind: "Split";
      test: SymbolicValue;
      testKind: "truthy" | "nullish";
      decision: Decision;
      consequent: Outcome;
      alternate: Outcome;
    };

type BranchOperator = "ternary" | "&&" | "||" | "??" | "optional";

type EvaluationMode = "render" | "effect";

interface WalkState {
  guards: SymbolicValue[];
  isAsync: boolean;
}

export interface EffectCall {
  hookKind: HookKind;
  callback: SymbolicValue;
  dependencies: SourceLocation | null;
  loc: SourceLocation;
}

export interface CollectedEffects {
  updates: StateUpdate[];
  delegates: string[];
}

export interface ModuleFunctionLoader {
  (name: string): HIRFunction | null;
}

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

const foldUnary = (operator: string, value: SymbolicValue): SymbolicValue => {
  if (operator === "!" && value.kind === "Primitive")
    return { kind: "Primitive", value: !value.value };
  if (operator === "!") return negate(value);
  return { kind: "UnaryExpression", operator, value };
};

const isDecidedTruthy = (value: SymbolicValue): boolean | null => {
  if (value.kind === "Primitive") return Boolean(value.value);
  if (
    value.kind === "JsxExpression" ||
    value.kind === "JsxFragment" ||
    value.kind === "Function" ||
    value.kind === "ObjectExpression" ||
    value.kind === "ArrayExpression"
  ) {
    return true;
  }
  return null;
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
  readonly #definitions = new Map<IdentifierId, InstructionValue>();
  readonly #functions: HIRFunction[] = [];
  readonly #bindings = new Map<string, Binding>();
  readonly #propBindings = new Map<string, Binding>();
  readonly #branchOperators = new Map<BlockId, BranchOperator>();
  readonly placeDomains = new Map<string, Domain>();
  readonly bailouts: Bailout[] = [];
  readonly effectCalls: EffectCall[] = [];
  readonly renderedComponents = new Set<string>();
  #mode: EvaluationMode = "render";
  #collected: CollectedEffects = { updates: [], delegates: [] };
  #blockVisits = 0;
  #inlineDepth = 0;

  constructor(resolver: DomainResolver, loadModuleFunction: ModuleFunctionLoader) {
    this.#resolver = resolver;
    this.#loadModuleFunction = loadModuleFunction;
  }

  get bindings(): Binding[] {
    return [...this.#bindings.values()];
  }

  getFunction(functionId: number): HIRFunction | null {
    return this.#functions[functionId] ?? null;
  }

  #registerFunction(fn: HIRFunction): SymbolicValue {
    this.#functions.push(fn);
    return { kind: "Function", functionId: this.#functions.length - 1, loc: fn.loc };
  }

  #unknown(reason: string, loc: SourceLocation): SymbolicValue {
    return { kind: "Unknown", reason, loc };
  }

  #createBinding(
    name: string,
    kind: BindingKind,
    loc: SourceLocation,
    options: Partial<Pick<Binding, "hookKind" | "propName" | "initial">> = {},
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
    };
    this.#bindings.set(key, binding);
    this.placeDomains.set(getPlaceKey(binding, []), binding.domain);
    return binding;
  }

  #readBinding(binding: Binding, path: string[], loc: SourceLocation): SymbolicValue {
    const key = getPlaceKey(binding, path);
    if (path.length > 0 && !this.placeDomains.has(key))
      this.placeDomains.set(key, this.#resolver.getDomain(loc));
    return { kind: "Binding", binding, path };
  }

  #read(place: Place): SymbolicValue {
    return this.#values.get(place.identifier.id) ?? this.#unknown("free-variable", place.loc);
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

  #getPropertyName(place: Place): string | null {
    const definition = this.#definitions.get(place.identifier.id);
    return definition?.kind === "PropertyLoad" ? String(definition.property) : null;
  }

  #bindHookResult(
    place: Place,
    hook: Extract<SymbolicValue, { kind: "HookResult" }>,
  ): SymbolicValue {
    const name = getIdentifierName(place) ?? hook.name;
    const loc = getDeclarationLocation(place);
    switch (hook.hookKind) {
      case "useRef":
        return {
          kind: "Binding",
          binding: this.#createBinding(name, "ref", loc, { hookKind: hook.hookKind }),
          path: [],
        };
      case "useContext":
        return {
          kind: "Binding",
          binding: this.#createBinding(name, "context", loc, { hookKind: hook.hookKind }),
          path: [],
        };
      default:
        return {
          kind: "Binding",
          binding: this.#createBinding(name, "hook", loc, { hookKind: hook.hookKind }),
          path: [],
        };
    }
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
      return [
        { kind: "Binding", binding, path: [] },
        { kind: "Setter", binding },
      ];
    }
    if (value.hookKind === "useReducer" && valuePlace) {
      const binding = this.#createBinding(
        getIdentifierName(valuePlace) ?? "state",
        "reducer",
        valuePlace.loc,
        {
          hookKind: value.hookKind,
          initial: secondArgument ?? null,
        },
      );
      return [
        { kind: "Binding", binding, path: [] },
        { kind: "Dispatch", binding, reducer: firstArgument ?? this.#unknown("reducer", loc) },
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
        this.#write(place, destructured[index] ?? this.#unknown("destructure", place.loc));
      });
      return;
    }
    for (const property of pattern.properties) {
      if (property.kind === "Spread") {
        this.#write(property.place, this.#unknown("rest", property.place.loc));
        continue;
      }
      const key =
        property.key.kind === "string" || property.key.kind === "identifier"
          ? property.key.name
          : null;
      const localName = getIdentifierName(property.place) ?? key ?? "value";
      if (key === null) {
        this.#write(property.place, this.#unknown("computed-key", property.place.loc));
      } else if (value.kind === "Props") {
        this.#write(property.place, {
          kind: "Binding",
          binding: this.#getPropBinding(key, localName, property.place.loc),
          path: [],
        });
      } else if (value.kind === "HookResult") {
        this.#write(property.place, {
          kind: "Binding",
          binding: this.#createBinding(localName, "hook", property.place.loc, {
            hookKind: value.hookKind,
          }),
          path: [],
        });
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
        return this.#readBinding(object.binding, [...object.path, property], loc);
      case "Props":
        return {
          kind: "Binding",
          binding: this.#getPropBinding(property, property, loc),
          path: [],
        };
      case "ObjectExpression":
        return (
          object.properties.findLast((candidate) => candidate.key === property)?.value ??
          (object.spreads.length > 0
            ? this.#unknown("spread", loc)
            : { kind: "Primitive", value: undefined })
        );
      case "ArrayExpression":
        return property === "length" && object.spreads.length === 0
          ? { kind: "Primitive", value: object.elements.length }
          : this.#unknown("member", loc);
      case "Global":
        return { kind: "Global", name: `${object.name}.${property}`, module: object.module };
      case "Conditional":
        return {
          ...object,
          consequent: this.#evaluatePropertyLoad(object.consequent, property, loc),
          alternate: this.#evaluatePropertyLoad(object.alternate, property, loc),
        };
      default:
        return this.#unknown("member", loc);
    }
  }

  #getJsxTag(tag: Extract<InstructionValue, { kind: "JsxExpression" }>["tag"]): SymbolicValue {
    if (tag.kind === "BuiltinTag") return { kind: "Primitive", value: tag.name };
    return this.#read(tag);
  }

  #buildJsx(
    tag: SymbolicValue,
    props: Array<JsxProp | JsxSpreadProp>,
    children: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue {
    if (tag.kind === "Conditional") {
      return {
        ...tag,
        consequent: this.#buildJsx(tag.consequent, props, children, loc),
        alternate: this.#buildJsx(tag.alternate, props, children, loc),
      };
    }
    const jsxTag: JsxTag =
      tag.kind === "Primitive" && typeof tag.value === "string"
        ? { kind: "BuiltinTag", name: tag.value }
        : {
            kind: "Component",
            name:
              tag.kind === "Global"
                ? tag.name
                : tag.kind === "Binding"
                  ? tag.binding.name
                  : "Unknown",
          };
    if (jsxTag.kind === "Component") this.renderedComponents.add(jsxTag.name);
    return { kind: "JsxExpression", tag: jsxTag, props, children, loc };
  }

  #callFunction(
    callee: Extract<SymbolicValue, { kind: "Function" }>,
    args: SymbolicValue[],
    loc: SourceLocation,
    state: WalkState,
  ): SymbolicValue {
    const fn = this.getFunction(callee.functionId);
    if (!fn || this.#inlineDepth >= MAX_INLINE_DEPTH) return this.#unknown("call", loc);
    this.#inlineDepth++;
    try {
      return this.evaluateFunction(fn, args, state);
    } finally {
      this.#inlineDepth--;
    }
  }

  #recordUpdate(binding: Binding, value: SymbolicValue, state: WalkState): void {
    if (this.#mode !== "effect") return;
    this.#collected.updates.push({
      binding,
      value:
        state.isAsync && value.kind !== "Primitive"
          ? this.#unknown("async", GeneratedSource)
          : value,
      guards: state.guards,
      isAsync: state.isAsync,
    });
  }

  #applySetter(
    setter: Extract<SymbolicValue, { kind: "Setter" }>,
    argument: SymbolicValue | undefined,
    state: WalkState,
  ): void {
    if (!argument)
      return this.#recordUpdate(setter.binding, { kind: "Primitive", value: undefined }, state);
    if (argument.kind === "Function") {
      const updated = this.#callFunction(
        argument,
        [{ kind: "Binding", binding: setter.binding, path: [] }],
        setter.binding.loc,
        state,
      );
      return this.#recordUpdate(setter.binding, updated, state);
    }
    this.#recordUpdate(setter.binding, argument, state);
  }

  #applyDispatch(
    dispatch: Extract<SymbolicValue, { kind: "Dispatch" }>,
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
            [
              { kind: "Binding", binding: dispatch.binding, path: [] },
              action ?? { kind: "Primitive", value: undefined },
            ],
            loc,
            state,
          )
        : this.#unknown("dispatch", loc);
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
    const hookKind = this.#currentFunction
      ? getHookKind(this.#currentFunction.env, calleePlace.identifier)
      : null;
    if (hookKind !== null)
      return this.#evaluateHookCall(hookKind, callee, args, argumentPlaces, loc, state);
    switch (callee.kind) {
      case "Function":
        return this.#callFunction(callee, args, loc, state);
      case "Setter":
        this.#applySetter(callee, args[0], state);
        return { kind: "Primitive", value: undefined };
      case "Dispatch":
        this.#applyDispatch(callee, args[0], loc, state);
        return { kind: "Primitive", value: undefined };
      case "Binding":
        if (callee.binding.kind === "prop" && this.#mode === "effect")
          this.#collected.delegates.push(
            callee.path.length > 0
              ? `${callee.binding.name}.${callee.path.join(".")}`
              : callee.binding.name,
          );
        break;
      default:
        break;
    }
    for (const argument of args) this.#visitCallbackArgument(argument, state);
    const returnType = this.#resolver.getTypeText(loc);
    if (
      this.#mode === "render" &&
      returnType !== null &&
      RENDERABLE_RETURN_TYPE_PATTERN.test(returnType)
    ) {
      this.bailouts.push({
        reason: "unknown-call",
        message: "call returns JSX the analysis can't see into",
        loc,
      });
    }
    return this.#unknown("call", loc);
  }

  #visitCallbackArgument(argument: SymbolicValue, state: WalkState): void {
    if (this.#mode !== "effect") return;
    const asyncState = { ...state, isAsync: true };
    if (argument.kind === "Setter")
      this.#recordUpdate(
        argument.binding,
        this.#unknown("callback-argument", GeneratedSource),
        asyncState,
      );
    if (argument.kind === "Function")
      this.#callFunction(
        argument,
        [this.#unknown("callback-argument", argument.loc)],
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
      return { kind: "Primitive", value: undefined };
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
    const propertyName = this.#getPropertyName(instruction.property);
    const argumentPlaces = instruction.args.map(getPlaceOrSpread);
    const args = argumentPlaces.map((place) => this.#read(place));
    const [callback] = args;
    if (propertyName === "map" && callback?.kind === "Function") {
      const fn = this.getFunction(callback.functionId);
      const parameter = fn?.params[0];
      const itemPlace = parameter ? getPlaceOrSpread(parameter) : null;
      const item: SymbolicValue = itemPlace
        ? {
            kind: "Binding",
            binding: this.#createBinding(
              getIdentifierName(itemPlace) ?? "item",
              "item",
              itemPlace.loc,
            ),
            path: [],
          }
        : this.#unknown("item", instruction.loc);
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
      return this.#unknown("async", instruction.loc);
    }
    const callee = this.#read(instruction.property);
    return this.#evaluateCall(
      callee,
      instruction.property,
      args,
      argumentPlaces,
      instruction.loc,
      state,
    );
  }

  #evaluateInstruction(instruction: Instruction, state: WalkState): void {
    const { value } = instruction;
    this.#definitions.set(instruction.lvalue.identifier.id, value);
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
        this.#write(value.lvalue.place, { kind: "Primitive", value: undefined });
        return { kind: "Primitive", value: undefined };
      case "Destructure":
        this.#evaluateDestructure(value);
        return this.#read(value.value);
      case "LoadGlobal":
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
          : this.#unknown("computed-member", value.loc);
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
                ? [{ kind: "Primitive", value: undefined }]
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
            : { kind: "JsxSpreadAttribute", value: this.#read(attribute.argument) },
        );
        return this.#buildJsx(
          this.#getJsxTag(value.tag),
          props,
          (value.children ?? []).map((child) => this.#read(child)),
          value.loc,
        );
      }
      case "JsxFragment":
        return { kind: "JsxFragment", children: value.children.map((child) => this.#read(child)) };
      case "Await":
        return this.#unknown("async", value.loc);
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
        return this.#unknown(value.kind, value.loc);
      case "StartMemoize":
      case "FinishMemoize":
      case "Debugger":
        return { kind: "Primitive", value: undefined };
      default:
        return assertExhaustive(value, "Unhandled instruction value");
    }
  }

  #resolvePhi(phi: Phi, outcome: Outcome): SymbolicValue {
    switch (outcome.kind) {
      case "Fallthrough": {
        const operand = outcome.from === null ? undefined : phi.operands.get(outcome.from);
        return operand ? this.#read(operand) : this.#unknown("loop", phi.place.loc);
      }
      case "Split":
        return {
          kind: "Conditional",
          test: outcome.test,
          testKind: outcome.testKind,
          consequent: this.#resolvePhi(phi, outcome.consequent),
          alternate: this.#resolvePhi(phi, outcome.alternate),
          decision: outcome.decision,
        };
      case "Return":
        return this.#unknown("unreachable", phi.place.loc);
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  #isFallthroughOnly(outcome: Outcome): boolean {
    if (outcome.kind === "Split")
      return (
        this.#isFallthroughOnly(outcome.consequent) && this.#isFallthroughOnly(outcome.alternate)
      );
    return outcome.kind === "Fallthrough";
  }

  #hasFallthrough(outcome: Outcome): boolean {
    if (outcome.kind === "Split")
      return this.#hasFallthrough(outcome.consequent) || this.#hasFallthrough(outcome.alternate);
    return outcome.kind === "Fallthrough";
  }

  /**
   * Continues past a join. When every path reaches the join, phis merge into conditionals
   * and the rest is walked once. When some paths returned, the rest is walked separately
   * for each path that reaches the join, with that path's guards.
   */
  #continueAfter(
    outcome: Outcome,
    join: BlockId,
    stopAt: BlockId | null,
    state: WalkState,
  ): Outcome {
    const block = this.#getBlock(join);
    if (this.#isFallthroughOnly(outcome)) {
      for (const phi of block.phis) this.#write(phi.place, this.#resolvePhi(phi, outcome));
      return this.#walk(join, stopAt, null, state, true);
    }
    const resume = (current: Outcome, guards: SymbolicValue[]): Outcome => {
      switch (current.kind) {
        case "Return":
          return current;
        case "Fallthrough":
          return this.#walk(join, stopAt, current.from, { ...state, guards }, false);
        case "Split":
          return {
            ...current,
            consequent: resume(current.consequent, [...guards, this.#guardFor(current, true)]),
            alternate: resume(current.alternate, [...guards, this.#guardFor(current, false)]),
          };
        default:
          return assertExhaustive(current, "Unhandled outcome");
      }
    };
    return this.#hasFallthrough(outcome) ? resume(outcome, state.guards) : outcome;
  }

  #guardFor(split: Extract<Outcome, { kind: "Split" }>, isConsequent: boolean): SymbolicValue {
    const test: SymbolicValue =
      split.testKind === "nullish"
        ? {
            kind: "BinaryExpression",
            operator: "!=",
            left: split.test,
            right: { kind: "Primitive", value: null },
          }
        : split.test;
    return isConsequent ? test : negate(test);
  }

  #getBlock(blockId: BlockId) {
    const block = this.#currentFunction?.body.blocks.get(blockId);
    if (!block) throw new Error(`Block bb${blockId} is missing`);
    return block;
  }

  #currentFunction: HIRFunction | null = null;

  #split(
    test: Place,
    consequent: BlockId,
    alternate: BlockId,
    fallthrough: BlockId,
    terminal: Terminal,
    from: BlockId,
    stopAt: BlockId | null,
    state: WalkState,
  ): Outcome {
    const operator = this.#branchOperators.get(fallthrough) ?? "ternary";
    const testValue = this.#read(test);
    const testKind = operator === "??" || operator === "optional" ? "nullish" : "truthy";
    const decision: Decision = {
      terminalId: terminal.id,
      probe: this.#resolver.isExpression(test.loc) ? testKind : "none",
      loc: test.loc,
    };
    const testGuard: SymbolicValue =
      testKind === "nullish"
        ? {
            kind: "BinaryExpression",
            operator: "!=",
            left: testValue,
            right: { kind: "Primitive", value: null },
          }
        : testValue;
    const walkArm = (block: BlockId, isConsequent: boolean): Outcome => {
      const guards = [...state.guards, isConsequent ? testGuard : negate(testGuard)];
      return block === fallthrough
        ? { kind: "Fallthrough", from }
        : this.#walk(block, fallthrough, from, { ...state, guards }, false);
    };
    const consequentOutcome = walkArm(consequent, true);
    const alternateOutcome = walkArm(alternate, false);
    const isSwapped = operator === "&&";
    const decided = isDecidedTruthy(testValue);
    const split: Outcome =
      decided !== null && testKind === "truthy"
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
    return this.#continueAfter(split, fallthrough, stopAt, state);
  }

  #walkSwitch(
    terminal: Extract<Terminal, { kind: "switch" }>,
    from: BlockId,
    stopAt: BlockId | null,
    state: WalkState,
  ): Outcome {
    const discriminant = this.#read(terminal.test);
    const buildCases = (index: number): Outcome => {
      const switchCase = terminal.cases[index];
      if (!switchCase) return { kind: "Fallthrough", from };
      const caseOutcome: Outcome =
        switchCase.block === terminal.fallthrough
          ? { kind: "Fallthrough", from }
          : this.#walk(switchCase.block, terminal.fallthrough, from, state, false);
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
    return this.#continueAfter(buildCases(0), terminal.fallthrough, stopAt, state);
  }

  /**
   * Walks blocks from `blockId` until a return, or until control reaches `stopAt`.
   */
  #walk(
    blockId: BlockId,
    stopAt: BlockId | null,
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
        return { kind: "Return", value: this.#unknown("too-complex", GeneratedSource) };
      const block = this.#getBlock(currentId);
      if (!isPhiResolved) {
        for (const phi of block.phis)
          this.#write(phi.place, this.#resolvePhi(phi, { kind: "Fallthrough", from: previousId }));
      }
      for (const instruction of block.instructions) {
        this.#evaluateInstruction(instruction, currentState);
        if (instruction.value.kind === "Await") currentState = { ...currentState, isAsync: true };
      }
      const { terminal } = block;
      switch (terminal.kind) {
        case "return":
          return { kind: "Return", value: this.#read(terminal.value) };
        case "throw":
        case "unreachable":
          return { kind: "Return", value: this.#unknown(terminal.kind, terminal.loc) };
        case "unsupported":
          return { kind: "Return", value: this.#unknown("unsupported", terminal.loc) };
        case "goto":
          if (terminal.block === stopAt) return { kind: "Fallthrough", from: currentId };
          previousId = currentId;
          currentId = terminal.block;
          isPhiResolved = false;
          continue;
        case "if":
          return this.#split(
            terminal.test,
            terminal.consequent,
            terminal.alternate,
            terminal.fallthrough,
            terminal,
            currentId,
            stopAt,
            currentState,
          );
        case "branch":
          return this.#split(
            terminal.test,
            terminal.consequent,
            terminal.alternate,
            terminal.fallthrough,
            terminal,
            currentId,
            stopAt,
            currentState,
          );
        case "switch":
          return this.#walkSwitch(terminal, currentId, stopAt, currentState);
        case "ternary":
        case "logical":
        case "optional":
          this.#branchOperators.set(
            terminal.fallthrough,
            terminal.kind === "logical" ? terminal.operator : terminal.kind,
          );
          previousId = currentId;
          currentId = terminal.test;
          isPhiResolved = false;
          continue;
        case "label":
        case "sequence":
        case "try":
          previousId = currentId;
          currentId = terminal.block;
          isPhiResolved = false;
          continue;
        case "maybe-throw":
          previousId = currentId;
          currentId = terminal.continuation;
          isPhiResolved = false;
          continue;
        case "for":
        case "for-of":
        case "for-in":
        case "while":
        case "do-while":
          this.bailouts.push({
            reason: "loop",
            message: "values assigned in a loop are not modeled",
            loc: terminal.loc,
          });
          previousId = null;
          currentId = terminal.fallthrough;
          isPhiResolved = false;
          continue;
        default:
          return assertExhaustive(terminal, "Unhandled terminal");
      }
    }
  }

  #toValue(outcome: Outcome, loc: SourceLocation): SymbolicValue {
    switch (outcome.kind) {
      case "Return":
        return outcome.value;
      case "Fallthrough":
        return this.#unknown("fallthrough", loc);
      case "Split":
        return {
          kind: "Conditional",
          test: outcome.test,
          testKind: outcome.testKind,
          consequent: this.#toValue(outcome.consequent, loc),
          alternate: this.#toValue(outcome.alternate, loc),
          decision: outcome.decision,
        };
      default:
        return assertExhaustive(outcome, "Unhandled outcome");
    }
  }

  evaluateFunction(
    fn: HIRFunction,
    args: SymbolicValue[],
    state: WalkState = { guards: [], isAsync: false },
  ): SymbolicValue {
    const previousFunction = this.#currentFunction;
    this.#currentFunction = fn;
    try {
      fn.params.forEach((parameter, index) => {
        const place = getPlaceOrSpread(parameter);
        this.#write(
          place,
          parameter.kind === "Spread"
            ? this.#unknown("rest", place.loc)
            : (args[index] ?? { kind: "Primitive", value: undefined }),
        );
      });
      return this.#toValue(this.#walk(fn.body.entry, null, null, state, false), fn.loc);
    } finally {
      this.#currentFunction = previousFunction;
    }
  }

  /**
   * Evaluates a component in render mode: its first parameter is the props object.
   */
  evaluateComponent(fn: HIRFunction): SymbolicValue {
    this.#mode = "render";
    return this.evaluateFunction(fn, [{ kind: "Props" }]);
  }

  /**
   * Evaluates an event handler or effect callback and returns the state updates and prop
   * calls it makes.
   */
  collectEffects(callback: SymbolicValue, args: SymbolicValue[]): CollectedEffects {
    const previousMode = this.#mode;
    const previousCollected = this.#collected;
    this.#mode = "effect";
    this.#collected = { updates: [], delegates: [] };
    try {
      if (callback.kind === "Function") {
        const fn = this.getFunction(callback.functionId);
        if (fn) this.evaluateFunction(fn, args);
      }
      if (callback.kind === "Setter")
        this.#recordUpdate(callback.binding, this.#unknown("event", GeneratedSource), {
          guards: [],
          isAsync: false,
        });
      if (callback.kind === "Binding" && callback.binding.kind === "prop")
        this.#collected.delegates.push(callback.binding.name);
      return this.#collected;
    } finally {
      this.#mode = previousMode;
      this.#collected = previousCollected;
    }
  }
}
