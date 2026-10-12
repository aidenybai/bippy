import { GeneratedSource } from "../react-compiler/HIR/HIR.js";
import type { SourceLocation } from "../react-compiler/HIR/HIR.js";
import type { Interpreter } from "./interpret.js";
import type { SymbolicValue, Handler, HandlerTrigger, JsxProp, JsxTag } from "./types.js";
import { forEachJsxElement } from "./utils/traverse.js";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

export const ANY_EVENT = "*";

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  (tag.kind !== "BuiltinTag" && (isCallable(prop.value) || hasCallableField(prop.value)));

const isCallable = (value: SymbolicValue): boolean =>
  value.kind === "Setter" || value.kind === "Function";

const hasCallableField = (value: SymbolicValue): boolean =>
  value.kind === "ObjectExpression" &&
  value.properties.some((property) => isCallable(property.value));

// React calls a ref callback on attach, so it runs like a layout effect.
const isRefCallback = (prop: JsxProp): boolean =>
  prop.name === "ref" && (prop.value.kind === "Function" || prop.value.kind === "Setter");

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
      return `object:${value.properties.map((property) => getHandlerKey(property.value)).join(",")}`;
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
  const handlerIds = new Map<string, string | null>();

  const addTransition = (
    trigger: HandlerTrigger,
    handler: SymbolicValue,
    args: SymbolicValue[],
    loc: SourceLocation,
  ): string | null => {
    const { updates, delegates } = interpreter.collectEffects(handler, args);
    if (updates.length === 0 && delegates.length === 0) return null;
    const id = `t${handlers.length + 1}`;
    handlers.push({ id, trigger, updates, delegates, loc });
    return id;
  };

  for (const effectCall of interpreter.effectCalls) {
    const trigger: HandlerTrigger = {
      kind: "Effect",
      hookKind: effectCall.hookKind,
      dependencies: effectCall.dependencies,
    };
    addTransition(trigger, effectCall.callback, effectCall.args, effectCall.loc);
  }
  const refCallbackKeys = new Set<string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") {
        if (prop.value.kind === "Unknown")
          prop.handlerId = addTransition(
            { kind: "Event", tag: element.tag.name, event: ANY_EVENT },
            prop.value,
            [],
            prop.value.loc,
          );
        const spreadHandlers = getSpreadHandlers(element.tag, prop.value);
        if (spreadHandlers)
          prop.handlerId = addTransition(
            { kind: "Event", tag: element.tag.name, event: ANY_EVENT },
            spreadHandlers,
            [{ kind: "Unknown", reason: "event", loc: GeneratedSource }],
            element.loc,
          );
        continue;
      }
      if (isRefCallback(prop)) {
        const key = getHandlerKey(prop.value);
        if (key !== null && !refCallbackKeys.has(key)) {
          refCallbackKeys.add(key);
          addTransition(
            { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null },
            prop.value,
            [{ kind: "Unknown", reason: "event", loc: GeneratedSource }],
            getHandlerLocation(prop.value),
          );
        }
        continue;
      }
      if (!isHandlerProp(element.tag, prop)) continue;
      const key = getHandlerKey(prop.value);
      if (key === null) continue;
      if (!handlerIds.has(key)) {
        const trigger: HandlerTrigger = {
          kind: "Event",
          tag: element.tag.name,
          event: prop.name,
        };
        const event: SymbolicValue = { kind: "Unknown", reason: "event", loc: GeneratedSource };
        handlerIds.set(
          key,
          addTransition(trigger, prop.value, [event], getHandlerLocation(prop.value)),
        );
      }
      prop.handlerId = handlerIds.get(key) ?? null;
    }
  });
  return handlers;
};
