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
import { getPassedCallbacks } from "./symbolic-values";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

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

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  (tag.kind !== "BuiltinTag" && getPassedCallbacks([prop.value]).length > 0);

const isCallable = (value: SymbolicValue): boolean =>
  value.kind === "Setter" || value.kind === "Function";

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
  if (value.kind === "Function") return value.loc;
  if (value.kind === "Setter" || value.kind === "Binding") return value.binding.loc;
  if (value.kind === "Conditional") {
    const consequentLocation = getHandlerLocation(value.consequent);
    return consequentLocation === GeneratedSource
      ? getHandlerLocation(value.alternate)
      : consequentLocation;
  }
  return GeneratedSource;
};

class HandlerCollector {
  readonly handlers: Handler[] = [];
  readonly #interpreter: Interpreter;
  readonly #handlerIdsByKey = new Map<string, string | null>();
  readonly #refCallbackKeys = new Set<string>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  addHandler(
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    callbackArguments: SymbolicValue[],
    loc: SourceLocation,
  ): string | null {
    return this.addCollectedHandler(
      trigger,
      this.#interpreter.collectEffects(callback, callbackArguments),
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

  collectElementHandlers(element: JsxExpressionValue): void {
    for (const prop of element.props) {
      if (prop.kind === "JsxSpreadAttribute") this.#collectSpreadHandlers(element, prop);
      else if (isRefCallback(prop)) this.#collectRefCallback(prop);
      else if (isHandlerProp(element.tag, prop)) this.#collectEventHandler(element, prop);
    }
  }

  #addEventHandler(
    handlerKey: string,
    trigger: HandlerTrigger,
    callback: SymbolicValue,
    loc: SourceLocation,
  ): string | null {
    if (!this.#handlerIdsByKey.has(handlerKey))
      this.#handlerIdsByKey.set(
        handlerKey,
        this.addHandler(trigger, callback, [EVENT_ARGUMENT], loc),
      );
    return this.#handlerIdsByKey.get(handlerKey) ?? null;
  }

  #collectSpreadHandlers(element: JsxExpressionValue, prop: JsxSpreadProp): void {
    const trigger: HandlerTrigger = { kind: "Event", tag: element.tag.name, event: ANY_EVENT };
    if (prop.value.kind === "Unknown") {
      prop.handlerId = this.addHandler(trigger, prop.value, [], prop.value.loc);
      return;
    }
    const spreadHandlers = getSpreadHandlers(element.tag, prop);
    const spreadHandlerKey = spreadHandlers && getHandlerKey(spreadHandlers);
    if (spreadHandlers && spreadHandlerKey)
      prop.handlerId = this.#addEventHandler(
        spreadHandlerKey,
        trigger,
        spreadHandlers,
        element.loc,
      );
  }

  #collectRefCallback(prop: JsxProp): void {
    const refCallbackKey = getHandlerKey(prop.value);
    if (refCallbackKey === null || this.#refCallbackKeys.has(refCallbackKey)) return;
    this.#refCallbackKeys.add(refCallbackKey);
    this.addHandler(
      { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null },
      prop.value,
      [EVENT_ARGUMENT],
      getHandlerLocation(prop.value),
    );
  }

  #collectEventHandler(element: JsxExpressionValue, prop: JsxProp): void {
    const handlerKey = getHandlerKey(prop.value);
    if (handlerKey === null) return;
    prop.handlerId = this.#addEventHandler(
      handlerKey,
      { kind: "Event", tag: element.tag.name, event: prop.name },
      prop.value,
      getHandlerLocation(prop.value),
    );
  }
}

export const collectHandlers = (render: SymbolicValue, interpreter: Interpreter): Handler[] => {
  const collector = new HandlerCollector(interpreter);
  for (const effectCall of interpreter.effectCalls)
    collector.addHandler(
      { kind: "Effect", hookKind: effectCall.hookKind, dependencies: effectCall.dependencies },
      effectCall.callback,
      effectCall.callbackArguments,
      effectCall.loc,
    );
  collector.addCollectedHandler(
    { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null },
    interpreter.finishRenderPhaseEffects(),
    GeneratedSource,
  );
  forEachJsxElement(render, (element) => collector.collectElementHandlers(element));
  return collector.handlers;
};
