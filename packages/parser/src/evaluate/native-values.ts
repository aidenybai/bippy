import type { StaticNativeObjectValue, StaticObjectEntry, StaticValue } from "../types.js";
import { nativeFunction } from "../frameworks/stubs.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  objectValue,
  primitiveValue,
  unknownValue,
} from "./values.js";

const UNCERTAIN = Symbol("uncertain");

const MAX_LIFT_DEPTH = 8;

/** Native objects a mutator was called on with arguments the analysis could not see. */
const uncertainNativeObjects = new WeakSet<object>();

const toNative = (value: StaticValue): unknown => {
  switch (value.kind) {
    case "primitive":
      return value.value;
    case "list": {
      if (!hasDefiniteItems(value)) return UNCERTAIN;
      const items: unknown[] = [];
      for (const item of value.items) {
        const native = toNative(item);
        if (native === UNCERTAIN) return UNCERTAIN;
        items.push(native);
      }
      return items;
    }
    case "object": {
      const keys = getKnownObjectKeys(value);
      if (keys === null) return UNCERTAIN;
      const record: Record<string, unknown> = {};
      for (const key of keys) {
        const native = toNative(getObjectProperty(value, key));
        if (native === UNCERTAIN) return UNCERTAIN;
        record[key] = native;
      }
      return record;
    }
    case "regexp":
      return new RegExp(value.pattern, value.flags);
    case "native-object":
      return uncertainNativeObjects.has(value.value) ? UNCERTAIN : value.value;
    default:
      return UNCERTAIN;
  }
};

/** The JavaScript values `args` stand for; null when any part of one is uncertain. */
export const toNativeArguments = (args: StaticValue[]): unknown[] | null => {
  const natives: unknown[] = [];
  for (const argument of args) {
    const native = toNative(argument);
    if (native === UNCERTAIN) return null;
    natives.push(native);
  }
  return natives;
};

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface NativeCallFallback {
  (args: StaticValue[]): StaticValue;
}

/**
 * `callee` as a function the interpreter may invoke: it runs natively once every
 * argument is known, and yields `onUncertain(args)` otherwise. Exceptions are
 * reported as unknowns rather than raised, since they would surface at runtime
 * as an error boundary the static tree cannot place.
 */
export const pureNativeFunction = (
  name: string,
  callee: Function,
  thisValue: unknown,
  onUncertain: NativeCallFallback,
): StaticValue =>
  nativeFunction(name, (args, tools) => {
    const natives = toNativeArguments(args);
    if (natives === null) {
      for (const argument of args) tools.markEscaped(argument);
      return onUncertain(args);
    }
    try {
      return fromNativeValue(Reflect.apply(callee, thisValue, natives), `${name}()`);
    } catch (error) {
      return unknownValue(`${name}() threw: ${describeError(error)}`);
    }
  });

const liftObject = (value: object, name: string, depth: number): StaticValue => {
  if (depth > MAX_LIFT_DEPTH) return unknownValue(`${name}: native value nested too deeply`);
  if (Array.isArray(value)) {
    return listValue(value.map((item, index) => liftValue(item, `${name}[${index}]`, depth + 1)));
  }
  if (value instanceof Date) return { kind: "native-object", value };
  if (value instanceof RegExp) {
    return { kind: "regexp", pattern: value.source, flags: value.flags, lastIndex: 0 };
  }
  if (isPlainObject(value)) {
    return objectValue(
      Object.entries(value).map(([key, item]): StaticObjectEntry => ({
        kind: "property",
        key,
        value: liftValue(item, `${name}.${key}`, depth + 1),
      })),
    );
  }
  return unknownValue(`${name}: ${value.constructor.name} from native code`);
};

const liftValue = (value: unknown, name: string, depth: number): StaticValue => {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return primitiveValue(value);
    case "symbol":
      return unknownValue(`${name}: symbol from native code`);
    case "function":
      return pureNativeFunction(name, value, undefined, () =>
        unknownValue(`${name}() on dynamic arguments`),
      );
    case "object":
      return value === null ? primitiveValue(null) : liftObject(value, name, depth);
  }
};

/** `value`, as native code produced it, in the interpreter's terms. */
export const fromNativeValue = (value: unknown, name: string): StaticValue =>
  liftValue(value, name, 0);

const isMutatorName = (key: string): boolean => key.startsWith("set");

/**
 * A property of a native object, with methods bound so they run natively when
 * called. Mutators run on the analysis' own copy, mirroring the runtime; once
 * one runs with arguments the analysis cannot see, the object is unknown.
 */
export const getNativeObjectMember = (
  object: StaticNativeObjectValue,
  key: string,
): StaticValue => {
  const name = `${object.value.constructor.name}.${key}`;
  if (uncertainNativeObjects.has(object.value)) {
    return unknownValue(`${name} after a mutation on dynamic arguments`);
  }
  const member: unknown = Reflect.get(object.value, key);
  if (typeof member !== "function") return fromNativeValue(member, name);
  return pureNativeFunction(name, member, object.value, () => {
    if (isMutatorName(key)) uncertainNativeObjects.add(object.value);
    return unknownValue(`${name}() on dynamic arguments`);
  });
};

/** `new Date(...)` from known parts; null when a part is uncertain or no parts are given (the clock decides then). */
export const constructNativeDate = (args: StaticValue[]): StaticValue | null => {
  if (args.length === 0) return null;
  const natives = toNativeArguments(args);
  if (natives === null) return null;
  return fromNativeValue(Reflect.construct(Date, natives), "Date");
};
