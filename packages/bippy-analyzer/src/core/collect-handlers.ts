import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { Interpreter } from "./interpret";
import type { SymbolicValue, Handler, HandlerTrigger, JsxProp, JsxTag } from "./types";
import { forEachJsxElement } from "./utils/traverse";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

export const ANY_EVENT = "*";

const EVENT_ARGUMENT: SymbolicValue = { kind: "Unknown", reason: "event", loc: GeneratedSource };

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  (tag.kind !== "BuiltinTag" && (isCallable(prop.value) || hasCallableField(prop.value)));

const isCallable = (value: SymbolicValue): boolean =>
  value.kind === "Setter" || value.kind === "Function";

const hasCallableField = (value: SymbolicValue): boolean =>
  value.kind === "ObjectExpression" &&
  value.properties.some((property) => isCallable(property.value));

const isRefCallback = (prop: JsxProp): boolean => prop.name === "ref" && isCallable(prop.value);

const getSpreadHandlers = (tag: JsxTag, value: SymbolicValue): SymbolicValue | null => {
  if (value.kind !== "ObjectExpression") return null;
  const properties = value.properties.filter((property) =>
    isHandlerProp(tag, {
      kind: "JsxAttribute",
      name: property.key,
      value: property.value,
      handlerId: null,
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
    case "ObjectExpression":
      return `object:${value.properties
        .map((property) => `${property.key}=${getHandlerKey(property.value)}`)
        .join(",")}`;
    case "Binding":
      return value.binding.kind === "prop" ||
        value.binding.kind === "hook" ||
        value.binding.kind === "context"
        ? `binding:${value.binding.id}:${value.path.join(".")}`
        : null;
    default:
      return null;
  }
};

const getHandlerLocation = (value: SymbolicValue): SourceLocation => {
  if (value.kind === "Function") return value.loc;
  if (value.kind === "Setter" || value.kind === "Binding") return value.binding.loc;
  return GeneratedSource;
};

export const collectHandlers = (render: SymbolicValue, interpreter: Interpreter): Handler[] => {
  const handlers: Handler[] = [];
  const handlerIdsByKey = new Map<string, string | null>();

  const addHandler = (
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    callbackArguments: SymbolicValue[],
    loc: SourceLocation,
  ): string | null => {
    const { updates, delegates } = interpreter.collectEffects(callback, callbackArguments);
    if (updates.length === 0 && delegates.length === 0) return null;
    const handlerId = `t${handlers.length + 1}`;
    handlers.push({ id: handlerId, trigger, updates, delegates, loc });
    return handlerId;
  };

  const addEventHandler = (
    handlerKey: string,
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    loc: SourceLocation,
  ): string | null => {
    if (!handlerIdsByKey.has(handlerKey))
      handlerIdsByKey.set(handlerKey, addHandler(trigger, callback, [EVENT_ARGUMENT], loc));
    return handlerIdsByKey.get(handlerKey) ?? null;
  };

  for (const effectCall of interpreter.effectCalls) {
    const trigger: HandlerTrigger = {
      kind: "Effect",
      hookKind: effectCall.hookKind,
      dependencies: effectCall.dependencies,
    };
    addHandler(trigger, effectCall.callback, effectCall.callbackArguments, effectCall.loc);
  }
  const refCallbackKeys = new Set<string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") {
        const trigger: HandlerTrigger = { kind: "Event", tag: element.tag.name, event: ANY_EVENT };
        const spreadHandlers = getSpreadHandlers(element.tag, prop.value);
        const spreadHandlerKey = spreadHandlers && getHandlerKey(spreadHandlers);
        if (prop.value.kind === "Unknown")
          prop.handlerId = addHandler(trigger, prop.value, [], prop.value.loc);
        else if (spreadHandlers && spreadHandlerKey)
          prop.handlerId = addEventHandler(spreadHandlerKey, trigger, spreadHandlers, element.loc);
        continue;
      }
      if (isRefCallback(prop)) {
        const refCallbackKey = getHandlerKey(prop.value);
        if (refCallbackKey !== null && !refCallbackKeys.has(refCallbackKey)) {
          refCallbackKeys.add(refCallbackKey);
          addHandler(
            { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null },
            prop.value,
            [EVENT_ARGUMENT],
            getHandlerLocation(prop.value),
          );
        }
        continue;
      }
      if (!isHandlerProp(element.tag, prop)) continue;
      const handlerKey = getHandlerKey(prop.value);
      if (handlerKey === null) continue;
      prop.handlerId = addEventHandler(
        handlerKey,
        { kind: "Event", tag: element.tag.name, event: prop.name },
        prop.value,
        getHandlerLocation(prop.value),
      );
    }
  });
  return handlers;
};
