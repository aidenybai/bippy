import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { HIRFunction, SourceLocation } from "../react-compiler/HIR/HIR";
import type { Interpreter } from "./interpret";
import type { CollectedEffects } from "./effect-collector";
import type {
  ObjectExpressionValue,
  Binding,
  FunctionValue,
  Handler,
  HandlerTrigger,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  JsxTag,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { isExternalSource } from "./utils/is-external-source";
import { getValueKey } from "./utils/get-value-key";
import { UNDEFINED_VALUE, createUnknown, foldUnary, getPassedCallbacks } from "./symbolic-values";
import { getRenderGuards, intersectGuards } from "./utils/get-render-guards";
import { isStateBinding } from "./utils/is-state-binding";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;
const CAPTURE_SUFFIX = "Capture";
const NON_BUBBLING_EVENTS = new Set([
  "onScroll",
  "onMouseEnter",
  "onMouseLeave",
  "onPointerEnter",
  "onPointerLeave",
  "onLoad",
  "onError",
]);
const FORM_ACTION_PROPS = new Map([
  ["form", "action"],
  ["button", "formAction"],
  ["input", "formAction"],
]);
const FORM_ACTION_EVENTS = new Map([
  ["action", "submit"],
  ["formAction", "click"],
]);

export const ANY_EVENT = "*";

export const EVENT_ARGUMENT: SymbolicValue = {
  kind: "Unknown",
  reason: "event",
  loc: GeneratedSource,
};

export const isEffectHandler = (handler: Handler): boolean => handler.trigger.kind === "Effect";

export const isRenderHandler = (handler: Handler): boolean => handler.trigger.kind === "Render";

export const getBindingUpdates = (handlers: Handler[], binding: Binding): StateUpdate[] =>
  handlers
    .flatMap((handler) => handler.updates)
    .filter((update) => update.binding.id === binding.id);

const isFormActionProp = (tag: JsxTag, prop: JsxProp): boolean =>
  tag.kind === "BuiltinTag" && FORM_ACTION_PROPS.get(tag.name) === prop.name;

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  isFormActionProp(tag, prop) ||
  (tag.kind !== "BuiltinTag" && getPassedCallbacks([prop.value]).length > 0);

const getTriggerEvent = (prop: JsxProp): string => FORM_ACTION_EVENTS.get(prop.name) ?? prop.name;

const isCallable = (value: SymbolicValue): boolean =>
  value.kind === "Setter" ||
  value.kind === "Dispatch" ||
  value.kind === "Function" ||
  value.kind === "Bound";

const isRefCallback = (prop: JsxProp): boolean => prop.name === "ref" && isCallable(prop.value);

const getSpreadProperty = (spread: ObjectExpressionValue | null, key: string): SymbolicValue =>
  spread?.properties.find((property) => property.key === key)?.value ?? UNDEFINED_VALUE;

const getSpreadHandlers = (
  tag: JsxTag,
  prop: JsxSpreadProp,
  value: SymbolicValue = prop.value,
): ObjectExpressionValue | null => {
  if (value.kind === "Conditional") {
    const consequent = getSpreadHandlers(tag, prop, value.consequent);
    const alternate = getSpreadHandlers(tag, prop, value.alternate);
    if (!consequent && !alternate) return null;
    const keys = new Set(
      [...(consequent?.properties ?? []), ...(alternate?.properties ?? [])].map(
        (property) => property.key,
      ),
    );
    return {
      kind: "ObjectExpression",
      properties: [...keys].map((key) => ({
        key,
        value: {
          ...value,
          consequent: getSpreadProperty(consequent, key),
          alternate: getSpreadProperty(alternate, key),
        },
      })),
      spreads: [],
    };
  }
  if (value.kind !== "ObjectExpression") return null;
  const properties = value.properties.filter((property) =>
    isHandlerProp(tag, {
      kind: "JsxAttribute",
      name: property.key,
      value: property.value,
      handlerId: null,
      loc: prop.loc,
      file: prop.file,
    }),
  );
  return properties.length > 0 ? { kind: "ObjectExpression", properties, spreads: [] } : null;
};

const getHandlerKey = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "Function":
      return `function:${value.functionId}`;
    case "Setter":
      return `setter:${value.binding.id}`;
    case "Dispatch":
      return `dispatch:${value.binding.id}`;
    case "Bound": {
      const calleeKey = getHandlerKey(value.callee);
      return calleeKey === null
        ? null
        : `bound:${calleeKey}:${value.argumentValues.map(getValueKey).join(",")}`;
    }
    case "ArrayExpression":
      return `array:${value.elements.map(getHandlerKey).join(",")}`;
    case "ObjectExpression":
      return `object:${value.properties
        .map((property) => `${property.key}=${getHandlerKey(property.value)}`)
        .join(",")}`;
    case "Binding":
      return value.binding.kind === "prop" || isExternalSource(value.binding)
        ? `binding:${value.binding.id}:${value.path.join(".")}`
        : null;
    case "Conditional": {
      const consequentKey = getHandlerKey(value.consequent);
      const alternateKey = getHandlerKey(value.alternate);
      return consequentKey === null && alternateKey === null
        ? null
        : `conditional:${getValueKey(value.test)}?${consequentKey}:${alternateKey}`;
    }
    default:
      return null;
  }
};

const getHandlerLocation = (value: SymbolicValue): SourceLocation => {
  if (value.kind === "Function" || value.kind === "Bound") return value.loc;
  if (value.kind === "Setter" || value.kind === "Dispatch" || value.kind === "Binding")
    return value.binding.loc;
  if (value.kind === "Conditional") {
    const consequentLocation = getHandlerLocation(value.consequent);
    return consequentLocation === GeneratedSource
      ? getHandlerLocation(value.alternate)
      : consequentLocation;
  }
  return GeneratedSource;
};

const ENABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

const getEnabledGuards = (element: JsxExpressionValue): SymbolicValue[] => {
  if (element.tag.kind !== "BuiltinTag" || !ENABLEABLE_TAGS.has(element.tag.name)) return [];
  const disabled = element.props.find(
    (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "disabled",
  );
  return disabled ? [foldUnary("!", disabled.value)] : [];
};

const SUBMIT_TYPES = new Set(["submit", "image"]);

const isSubmitControl = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag") return false;
  const typeProp = element.props.find(
    (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "type",
  );
  const type = typeProp?.value.kind === "Primitive" ? typeProp.value.value : undefined;
  if (element.tag.name === "button")
    return typeProp === undefined || (typeof type === "string" && SUBMIT_TYPES.has(type));
  return element.tag.name === "input" && typeof type === "string" && SUBMIT_TYPES.has(type);
};

interface PlannedHandler {
  trigger: HandlerTrigger;
  callback: SymbolicValue;
  callbackArguments: SymbolicValue[];
  loc: SourceLocation;
  guards: SymbolicValue[];
  callbackGuards?: SymbolicValue[];
  props: Array<JsxProp | JsxSpreadProp>;
}

class HandlerCollector {
  readonly handlers: Handler[] = [];
  readonly #interpreter: Interpreter;
  readonly #plannedByKey = new Map<string | JsxSpreadProp, PlannedHandler>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  addHandler(
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    callbackArguments: SymbolicValue[],
    loc: SourceLocation,
    guards: SymbolicValue[] = [],
    callbackGuards: SymbolicValue[] = [],
  ): string | null {
    const runsCleanup =
      trigger.kind === "Effect" && trigger.hookKind !== "Custom" && trigger.dependencies !== "[]";
    return this.addCollectedHandler(
      trigger,
      this.#interpreter.collectEffects(
        callback,
        callbackArguments,
        guards,
        callbackGuards,
        runsCleanup,
      ),
      loc,
      guards,
    );
  }

  addCollectedHandler(
    trigger: HandlerTrigger,
    { updates, delegates }: CollectedEffects,
    loc: SourceLocation,
    guards: SymbolicValue[] = [],
  ): string | null {
    if (updates.length === 0 && delegates.length === 0) return null;
    const handlerId = `t${this.handlers.length + 1}`;
    this.handlers.push({ id: handlerId, trigger, updates, delegates, guards, loc });
    return handlerId;
  }

  planElementHandlers(
    element: JsxExpressionValue,
    renderGuards: SymbolicValue[],
    ancestors: JsxExpressionValue[],
  ): void {
    const eventGuards = [...renderGuards, ...getEnabledGuards(element)];
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") this.#planSpreadHandlers(element, prop, eventGuards);
      else if (isRefCallback(prop)) this.#planRefCallback(prop, renderGuards);
      else if (isHandlerProp(element.tag, prop))
        this.#planEventHandler(element, prop, eventGuards, ancestors);
    }
  }

  get plannedCallbacks(): SymbolicValue[] {
    return [...this.#plannedByKey.values()].map((planned) => planned.callback);
  }

  runPlannedHandlers(): void {
    for (const planned of this.#plannedByKey.values()) {
      const handlerId = this.addHandler(
        planned.trigger,
        planned.callback,
        planned.callbackArguments,
        planned.loc,
        planned.guards,
        planned.callbackGuards,
      );
      for (const prop of planned.props) prop.handlerId = handlerId;
    }
  }

  #plan(key: string | JsxSpreadProp, handler: PlannedHandler): void {
    const planned = this.#plannedByKey.get(key);
    if (!planned) {
      this.#plannedByKey.set(key, handler);
      return;
    }
    planned.guards = intersectGuards(planned.guards, handler.guards);
    planned.props.push(...handler.props);
  }

  #planSpreadHandlers(
    element: JsxExpressionValue,
    prop: JsxSpreadProp,
    guards: SymbolicValue[],
  ): void {
    const trigger: HandlerTrigger = { kind: "Event", tag: element.tag.name, event: ANY_EVENT };
    if (prop.value.kind === "Unknown") {
      this.#plan(prop, {
        trigger,
        callback: prop.value,
        callbackArguments: [],
        loc: prop.value.loc,
        guards,
        props: [prop],
      });
      return;
    }
    const spreadHandlers = getSpreadHandlers(element.tag, prop);
    const spreadHandlerKey = spreadHandlers && getHandlerKey(spreadHandlers);
    if (spreadHandlers && spreadHandlerKey)
      this.#plan(spreadHandlerKey, {
        trigger,
        callback: spreadHandlers,
        callbackArguments: [EVENT_ARGUMENT],
        loc: element.loc,
        guards,
        props: [prop],
      });
  }

  #planRefCallback(prop: JsxProp, guards: SymbolicValue[]): void {
    const refCallbackKey = getHandlerKey(prop.value);
    if (refCallbackKey === null) return;
    this.#plan(`ref:${refCallbackKey}`, {
      trigger: {
        kind: "Effect",
        hookKind: "useLayoutEffect",
        dependencies: null,
        dependencyPlaces: null,
      },
      callback: prop.value,
      callbackArguments: [EVENT_ARGUMENT],
      loc: getHandlerLocation(prop.value),
      guards,
      props: [],
    });
  }

  #planEventHandler(
    element: JsxExpressionValue,
    prop: JsxProp,
    guards: SymbolicValue[],
    ancestors: JsxExpressionValue[],
  ): void {
    const callback = this.#unwrapCallback(prop.value);
    if (getHandlerKey(callback) === null) return;
    const propagated = this.#getPropagatedCallbacks(element, prop, callback, ancestors);
    const handled: SymbolicValue =
      propagated.length > 0
        ? { kind: "ArrayExpression", elements: propagated, spreads: [] }
        : callback;
    const handlerKey = getHandlerKey(handled);
    if (handlerKey === null) return;
    const isWrapped = callback !== prop.value;
    this.#plan(isWrapped ? `wrapped:${handlerKey}` : handlerKey, {
      trigger: { kind: "Event", tag: element.tag.name, event: getTriggerEvent(prop) },
      callback: handled,
      callbackArguments: [EVENT_ARGUMENT],
      loc: getHandlerLocation(callback),
      guards,
      callbackGuards: isWrapped ? [createUnknown("wrapped-call", prop.loc)] : [],
      props: [prop],
    });
  }

  #getPropagatedCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    callback: SymbolicValue,
    ancestors: JsxExpressionValue[],
  ): SymbolicValue[] {
    const isBubbling =
      element.tag.kind === "BuiltinTag" &&
      EVENT_HANDLER_PATTERN.test(prop.name) &&
      !NON_BUBBLING_EVENTS.has(prop.name) &&
      !prop.name.endsWith(CAPTURE_SUFFIX);
    if (!isBubbling) return [];
    const chain = [
      ...ancestors.flatMap((ancestor) =>
        this.#getAncestorCallbacks(ancestor, `${prop.name}${CAPTURE_SUFFIX}`),
      ),
      callback,
      ...[...ancestors]
        .reverse()
        .flatMap((ancestor) => this.#getAncestorCallbacks(ancestor, prop.name)),
    ];
    const stopIndex = chain.findIndex((entry) => this.#loadsProperty(entry, "stopPropagation"));
    const clicked = stopIndex === -1 ? chain : chain.slice(0, stopIndex + 1);
    const propagated = [...clicked, ...this.#getSubmitCallbacks(element, prop, ancestors, clicked)];
    return propagated.length === 1 ? [] : propagated;
  }

  #getSubmitCallbacks(
    element: JsxExpressionValue,
    prop: JsxProp,
    ancestors: JsxExpressionValue[],
    clicked: SymbolicValue[],
  ): SymbolicValue[] {
    const form = ancestors.findLast(
      (ancestor) => ancestor.tag.kind === "BuiltinTag" && ancestor.tag.name === "form",
    );
    const isSubmitted =
      form !== undefined &&
      prop.name === "onClick" &&
      isSubmitControl(element) &&
      !clicked.some((callback) => this.#loadsProperty(callback, "preventDefault"));
    return isSubmitted ? this.#getAncestorCallbacks(form, "onSubmit") : [];
  }

  #getAncestorCallbacks(ancestor: JsxExpressionValue, name: string): SymbolicValue[] {
    return ancestor.props
      .flatMap((prop) =>
        prop.kind === "JsxAttribute" && prop.name === name
          ? [this.#unwrapCallback(prop.value)]
          : [],
      )
      .filter((callback) => getHandlerKey(callback) !== null);
  }

  #loadsProperty(callback: SymbolicValue, property: string): boolean {
    if (callback.kind !== "Function") return false;
    const hirFunction = this.#interpreter.functions.get(callback.functionId);
    return hirFunction !== null && loadsProperty(hirFunction, property);
  }

  #unwrapCallback(value: SymbolicValue): SymbolicValue {
    const wrapped = this.#interpreter.getWrappedCallbacks(value);
    if (!wrapped) return value;
    const [single] = wrapped;
    return wrapped.length === 1 && single
      ? single
      : { kind: "ArrayExpression", elements: wrapped, spreads: [] };
  }
}

const loadsProperty = (hirFunction: HIRFunction, property: string): boolean => {
  for (const block of hirFunction.body.blocks.values())
    for (const { value } of block.instructions) {
      if (value.kind === "PropertyLoad" && value.property === property) return true;
      const isClosure = value.kind === "FunctionExpression" || value.kind === "ObjectMethod";
      if (isClosure && loadsProperty(value.loweredFunc.func, property)) return true;
    }
  return false;
};

const getElementAncestors = (
  render: SymbolicValue,
): Map<JsxExpressionValue, JsxExpressionValue[]> => {
  const ancestorsByElement = new Map<JsxExpressionValue, JsxExpressionValue[]>();
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue, ancestors: JsxExpressionValue[]): void => {
    if (visited.has(node)) return;
    visited.add(node);
    switch (node.kind) {
      case "JsxExpression": {
        ancestorsByElement.set(node, ancestors);
        for (const prop of node.props) if (prop.kind === "JsxAttribute") walkPropValue(prop.value);
        const inner = node.tag.kind === "BuiltinTag" ? [...ancestors, node] : ancestors;
        for (const child of node.children) walk(child, inner);
        return;
      }
      case "JsxFragment":
        for (const child of node.children) walk(child, ancestors);
        return;
      case "Conditional":
        walk(node.consequent, ancestors);
        walk(node.alternate, ancestors);
        return;
      case "ArrayMap":
        walk(node.item, ancestors);
        return;
      default:
        return;
    }
  };
  const walkPropValue = (propValue: SymbolicValue): void => {
    switch (propValue.kind) {
      case "ArrayExpression":
        propValue.elements.forEach(walkPropValue);
        return;
      case "ObjectExpression":
        for (const property of propValue.properties) walkPropValue(property.value);
        return;
      default:
        walk(propValue, []);
    }
  };
  walk(render, []);
  return ancestorsByElement;
};

const collectWrappedCallbacks = (
  render: SymbolicValue,
  interpreter: Interpreter,
): Set<SymbolicValue> => {
  const wrapped = new Set<SymbolicValue>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || !isHandlerProp(element.tag, prop)) continue;
      for (const callback of interpreter.getWrappedCallbacks(prop.value) ?? [])
        wrapped.add(callback);
    }
  });
  return wrapped;
};

const getReadBindingIds = (handler: Handler): Set<number> => {
  const bindingIds = new Set<number>();
  for (const update of handler.updates)
    for (const read of [update.value, ...update.guards])
      forEachSymbolicValue(read, (part) => {
        if (part.kind === "Binding") bindingIds.add(part.binding.id);
      });
  return bindingIds;
};

const getCommitUpdates = (effects: Handler[]): StateUpdate[] => {
  const readIds = effects.map(getReadBindingIds);
  const interacting = effects.filter((effect, index) =>
    effects.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        (other.updates.some((update) => readIds[index]?.has(update.binding.id)) ||
          effect.updates.some((update) => readIds[otherIndex]?.has(update.binding.id))),
    ),
  );
  return interacting.flatMap((effect) =>
    effect.updates.map((update) => ({
      ...update,
      guards: [createUnknown(`fires ${effect.id}`, effect.loc), ...update.guards],
    })),
  );
};

const getStoredFunctions = (handlers: Handler[]): Map<number, FunctionValue[]> => {
  const storedFunctions = new Map<number, FunctionValue[]>();
  for (const update of handlers.flatMap((handler) => handler.updates)) {
    if (!isStateBinding(update.binding)) continue;
    const functions = getPassedCallbacks([update.value]).filter(
      (value): value is FunctionValue => value.kind === "Function",
    );
    if (functions.length > 0)
      storedFunctions.set(update.binding.id, [
        ...(storedFunctions.get(update.binding.id) ?? []),
        ...functions,
      ]);
  }
  return storedFunctions;
};

export const collectHandlers = (render: SymbolicValue, interpreter: Interpreter): Handler[] => {
  const renderPhaseEffects = interpreter.finishRenderPhaseEffects();
  const handlers = collectHandlersOnce(render, interpreter, renderPhaseEffects);
  const storedFunctions = getStoredFunctions(handlers);
  if (storedFunctions.size === 0) return handlers;
  interpreter.setStoredFunctions(storedFunctions);
  return collectHandlersOnce(render, interpreter, renderPhaseEffects);
};

const collectHandlersOnce = (
  render: SymbolicValue,
  interpreter: Interpreter,
  renderPhaseEffects: CollectedEffects,
): Handler[] => {
  const collector = new HandlerCollector(interpreter);
  const wrappedCallbacks = collectWrappedCallbacks(render, interpreter);
  const effectCalls = interpreter.effectCalls.filter(
    (effectCall) => !wrappedCallbacks.has(effectCall.callback),
  );
  const ancestorsByElement = getElementAncestors(render);
  for (const [element, renderGuards] of getRenderGuards(render))
    collector.planElementHandlers(element, renderGuards, ancestorsByElement.get(element) ?? []);
  for (const callback of [
    ...effectCalls.map((effectCall) => effectCall.callback),
    ...collector.plannedCallbacks,
  ])
    interpreter.forgetHandlerWrites(callback);
  for (const effectCall of effectCalls)
    collector.addHandler(
      {
        kind: "Effect",
        hookKind: effectCall.hookKind,
        dependencies: effectCall.dependencies,
        dependencyPlaces: effectCall.dependencyPlaces,
      },
      effectCall.callback,
      effectCall.callbackArguments,
      effectCall.loc,
    );
  const commitUpdates = getCommitUpdates(collector.handlers);
  if (commitUpdates.length > 0)
    collector.addCollectedHandler(
      { kind: "Effect", hookKind: "useEffect", dependencies: null, dependencyPlaces: null },
      { updates: commitUpdates, delegates: [] },
      GeneratedSource,
    );
  collector.addCollectedHandler({ kind: "Render" }, renderPhaseEffects, GeneratedSource);
  collector.runPlannedHandlers();
  return collector.handlers;
};
