import { nativeFunction } from "./stubs.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import {
  getObjectProperty,
  isNullish,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
} from "./values.js";

/** A modeled `EventTarget`: `on<type>` handlers live on the object, `addEventListener` registrations beside it. */
export interface EventTargetModel {
  value: StaticObjectValue;
  listeners: Map<string, StaticValue[]>;
}

export interface EventDispatchHost {
  call: (callee: StaticValue, args: StaticValue[]) => StaticValue;
}

const toKnownString = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" && typeof value.value === "string" ? value.value : null;

export const createEventTarget = (
  record: Record<string, StaticValue>,
  onListen: (type: string, listener: StaticValue) => void = () => {},
): EventTargetModel => {
  const listeners = new Map<string, StaticValue[]>();
  const value = objectFromRecord({
    ...record,
    addEventListener: nativeFunction("addEventListener", ([type, listener]) => {
      const typeName = toKnownString(type);
      if (typeName === null || !listener) return UNDEFINED_VALUE;
      const registered = listeners.get(typeName) ?? [];
      if (!registered.includes(listener)) listeners.set(typeName, [...registered, listener]);
      onListen(typeName, listener);
      return UNDEFINED_VALUE;
    }),
    removeEventListener: nativeFunction("removeEventListener", ([type, listener]) => {
      const typeName = toKnownString(type);
      if (typeName === null || !listener) return UNDEFINED_VALUE;
      listeners.set(
        typeName,
        (listeners.get(typeName) ?? []).filter((registered) => registered !== listener),
      );
      return UNDEFINED_VALUE;
    }),
  });
  return { value, listeners };
};

export const dispatchEvent = (
  host: EventDispatchHost,
  target: EventTargetModel,
  type: string,
  eventProperties: Record<string, StaticValue> = {},
): void => {
  const event = objectFromRecord({
    type: primitiveValue(type),
    target: target.value,
    currentTarget: target.value,
    ...eventProperties,
  });
  const handler = getObjectProperty(target.value, `on${type}`);
  if (isNullish(handler) !== true) host.call(handler, [event]);
  for (const listener of target.listeners.get(type) ?? []) host.call(listener, [event]);
};
