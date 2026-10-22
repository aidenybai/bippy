import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { Interpreter } from "./interpret";
import type { CollectedEffects } from "./effect-collector";
import type {
  Binding,
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
import { isExternalSource } from "./utils/is-external-source";
import { getValueKey } from "./utils/get-value-key";
import { foldUnary, getPassedCallbacks } from "./symbolic-values";
import { getRenderGuards, intersectGuards } from "./utils/get-render-guards";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;
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
  value.kind === "Setter" || value.kind === "Function" || value.kind === "Bound";

const isRefCallback = (prop: JsxProp): boolean => prop.name === "ref" && isCallable(prop.value);

const getSpreadHandlers = (tag: JsxTag, prop: JsxSpreadProp): SymbolicValue | null => {
  if (prop.value.kind !== "ObjectExpression") return null;
  const properties = prop.value.properties.filter((property) =>
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

interface PlannedHandler {
  trigger: HandlerTrigger;
  callback: SymbolicValue;
  callbackArguments: SymbolicValue[];
  loc: SourceLocation;
  guards: SymbolicValue[];
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
  ): string | null {
    return this.addCollectedHandler(
      trigger,
      this.#interpreter.collectEffects(callback, callbackArguments, guards),
      loc,
    );
  }

  addCollectedHandler(
    trigger: HandlerTrigger,
    { updates, delegates }: CollectedEffects,
    loc: SourceLocation,
  ): string | null {
    if (updates.length === 0 && delegates.length === 0) return null;
    const handlerId = `t${this.handlers.length + 1}`;
    this.handlers.push({ id: handlerId, trigger, updates, delegates, loc });
    return handlerId;
  }

  planElementHandlers(element: JsxExpressionValue, renderGuards: SymbolicValue[]): void {
    const eventGuards = [...renderGuards, ...getEnabledGuards(element)];
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") this.#planSpreadHandlers(element, prop, eventGuards);
      else if (isRefCallback(prop)) this.#planRefCallback(prop, renderGuards);
      else if (isHandlerProp(element.tag, prop)) this.#planEventHandler(element, prop, eventGuards);
    }
  }

  runPlannedHandlers(): void {
    for (const planned of this.#plannedByKey.values()) {
      const handlerId = this.addHandler(
        planned.trigger,
        planned.callback,
        planned.callbackArguments,
        planned.loc,
        planned.guards,
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

  #planEventHandler(element: JsxExpressionValue, prop: JsxProp, guards: SymbolicValue[]): void {
    const callback = this.#unwrapCallback(prop.value);
    const handlerKey = getHandlerKey(callback);
    if (handlerKey === null) return;
    this.#plan(handlerKey, {
      trigger: { kind: "Event", tag: element.tag.name, event: getTriggerEvent(prop) },
      callback,
      callbackArguments: [EVENT_ARGUMENT],
      loc: getHandlerLocation(callback),
      guards,
      props: [prop],
    });
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

export const collectHandlers = (render: SymbolicValue, interpreter: Interpreter): Handler[] => {
  const collector = new HandlerCollector(interpreter);
  const wrappedCallbacks = collectWrappedCallbacks(render, interpreter);
  for (const effectCall of interpreter.effectCalls)
    if (!wrappedCallbacks.has(effectCall.callback))
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
  collector.addCollectedHandler(
    { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null, dependencyPlaces: null },
    interpreter.finishRenderPhaseEffects(),
    GeneratedSource,
  );
  for (const [element, renderGuards] of getRenderGuards(render))
    collector.planElementHandlers(element, renderGuards);
  collector.runPlannedHandlers();
  return collector.handlers;
};
