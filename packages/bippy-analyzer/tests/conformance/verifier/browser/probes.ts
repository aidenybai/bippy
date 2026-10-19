import { cloneElement, isValidElement } from "react";
import type { ProbeHit } from "../types";
import { isRendering } from "../write-origins";
import { recordMutationProbe } from "./mutations";

interface HandlerFunction {
  (...handlerArguments: unknown[]): unknown;
}

const EVENT_PROP_PATTERN = /^on[A-Z]/;

let probeHits: ProbeHit[] = [];
let handlerHits: string[] = [];
const handlerProxies = new WeakMap<object, Map<string, object>>();

const wrapRenderedHandlers = (id: string, rendered: unknown): unknown => {
  if (Array.isArray(rendered)) {
    const wrappedItems = rendered.map((renderedItem) => wrapRenderedHandlers(id, renderedItem));
    return wrappedItems.every((wrappedItem, index) => wrappedItem === rendered[index])
      ? rendered
      : wrappedItems;
  }
  if (!isValidElement<Record<string, unknown>>(rendered)) return rendered;
  const props = Object.entries(rendered.props).map(([name, value]): [string, unknown] => [
    name,
    EVENT_PROP_PATTERN.test(name) ? wrapHandler(id, value) : wrapRenderedHandlers(id, value),
  ]);
  return props.every(([name, value]) => value === rendered.props[name])
    ? rendered
    : cloneElement(rendered, Object.fromEntries(props));
};

const isHandlerFunction = (value: unknown): value is HandlerFunction => typeof value === "function";

const callHandler = (
  id: string,
  handler: HandlerFunction,
  thisArgument: unknown,
  callArguments: unknown[],
): unknown => {
  if (isRendering())
    return wrapRenderedHandlers(id, Reflect.apply(handler, thisArgument, callArguments));
  handlerHits.push(id);
  return Reflect.apply(handler, thisArgument, callArguments);
};

const isSpreadProps = (value: unknown): value is object => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
};

const isWrappableMember = (
  spread: object,
  key: string | symbol,
  member: unknown,
  isEveryCallbackAHandler: boolean,
): boolean => {
  const isHandlerMember =
    isHandlerFunction(member) &&
    (isEveryCallbackAHandler || (typeof key === "string" && EVENT_PROP_PATTERN.test(key)));
  const isItemMember =
    isSpreadProps(member) &&
    (isEveryCallbackAHandler || (Array.isArray(spread) && !Array.isArray(member)));
  if (!isHandlerMember && !isItemMember) return false;
  const descriptor = Reflect.getOwnPropertyDescriptor(spread, key);
  return (
    descriptor === undefined || descriptor.configurable === true || descriptor.writable === true
  );
};

const createHandlerProxy = (
  id: string,
  target: object,
  isEveryCallbackAHandler: boolean,
): object =>
  isHandlerFunction(target)
    ? new Proxy(target, {
        apply: (handler, thisArgument, callArguments) =>
          callHandler(id, handler, thisArgument, callArguments),
      })
    : new Proxy(target, {
        get: (spread, key, receiver) => {
          const member: unknown = Reflect.get(spread, key, receiver);
          return isWrappableMember(spread, key, member, isEveryCallbackAHandler)
            ? wrapHandler(id, member, isEveryCallbackAHandler)
            : member;
        },
      });

const wrapHandler = (id: string, value: unknown, isEveryCallbackAHandler = false): unknown => {
  if (!isHandlerFunction(value) && !isSpreadProps(value)) return value;
  const proxies = handlerProxies.get(value) ?? new Map<string, object>();
  handlerProxies.set(value, proxies);
  const proxy = proxies.get(id) ?? createHandlerProxy(id, value, isEveryCallbackAHandler);
  proxies.set(id, proxy);
  return proxy;
};

export const resetProbeHits = (): void => {
  probeHits = [];
};

export const takeProbeHits = (): ProbeHit[] => {
  const hits = probeHits;
  resetProbeHits();
  return hits;
};

export const takeHandlerHits = (): string[] => {
  const hits = [...new Set(handlerHits)];
  handlerHits = [];
  return hits;
};

globalThis.__bippyProbe = (id, mode, value) => {
  if (mode === "mutation") return recordMutationProbe(id, value);
  if (mode === "handler" || mode === "callbacks")
    return wrapHandler(id, value, mode === "callbacks");
  probeHits.push({
    id,
    isTrueSide: mode === "nullish" ? value !== null && value !== undefined : Boolean(value),
  });
  return value;
};
