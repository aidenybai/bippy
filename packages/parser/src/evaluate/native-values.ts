import type {
  StaticListValue,
  StaticNativeObjectValue,
  StaticObjectEntry,
  StaticValue,
} from "../types.js";
import { element, nativeFunction } from "../frameworks/stubs.js";
import type { HostDocument } from "../host/host-document.js";
import { GLOBAL_INTERFACE_NAME } from "../host/realm-table.js";
import { REACT_ELEMENT_SYMBOL_KEYS } from "../react/element-shape.js";
import { EVENT_LISTENER_METHODS } from "./event-listeners.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const UNCERTAIN = Symbol("uncertain");

/** Native objects a mutator was called on with arguments the analysis could not see. */
const uncertainNativeObjects = new WeakSet<object>();

/** One interpreter value per native object, so identity comparisons and collection keys hold. */
const nativeObjectValues = new WeakMap<object, StaticNativeObjectValue>();

/** Properties the program adds to DOM nodes (`node.__lexicalKey`): interpreter values that never reach the native object. */
const expandoProperties = new WeakMap<object, Map<string, StaticValue>>();

/**
 * Members whose runtime value depends on layout, which the static document
 * never performs: every box is zero-sized here, so reading one is a guess.
 */
const LAYOUT_MEMBERS = new Set([
  "getBoundingClientRect",
  "getClientRects",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "offsetParent",
  "clientWidth",
  "clientHeight",
  "clientTop",
  "clientLeft",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
  "checkVisibility",
  "elementFromPoint",
  "elementsFromPoint",
  "caretRangeFromPoint",
  "caretPositionFromPoint",
]);

const PURE_METHOD_PREFIXES = [
  "get",
  "has",
  "is",
  "query",
  "contains",
  "matches",
  "closest",
  "compare",
  "item",
  "namedItem",
  "lookup",
  "check",
  "forEach",
  "entries",
  "keys",
  "values",
  "indexOf",
  "includes",
  "cloneNode",
  "intersectsNode",
  "toString",
  "toJSON",
  "toISOString",
  "toLocale",
  "toDateString",
  "toTimeString",
  "toUTCString",
  "valueOf",
];

/** The interface name of a native object, read off its prototype: a `Proxy` over a DOM map (`dataset`) answers `constructor` as a lookup. */
export const getNativeInterfaceName = (value: object): string => {
  const prototype = Reflect.getPrototypeOf(value);
  const constructor: unknown =
    prototype === null ? undefined : Reflect.get(prototype, "constructor");
  return typeof constructor === "function" ? constructor.name : "Object";
};

const isIterable = (value: object): value is Iterable<unknown> =>
  typeof Reflect.get(value, Symbol.iterator) === "function";

const isPureMethodName = (name: string): boolean =>
  PURE_METHOD_PREFIXES.some((prefix) => name.startsWith(prefix));

export const nativeObjectValue = (
  value: object,
  host: HostDocument | null,
): StaticNativeObjectValue => {
  let lifted = nativeObjectValues.get(value);
  if (!lifted) {
    lifted = { kind: "native-object", value, host };
    nativeObjectValues.set(value, lifted);
  }
  return lifted;
};

const toNative = (value: StaticValue, host: HostDocument | null): unknown => {
  switch (value.kind) {
    case "primitive":
      return value.value;
    case "list": {
      if (!hasDefiniteItems(value)) return UNCERTAIN;
      const items: unknown[] = [];
      for (const item of value.items) {
        const native = toNative(item, host);
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
        const native = toNative(getObjectProperty(value, key), host);
        if (native === UNCERTAIN) return UNCERTAIN;
        record[key] = native;
      }
      return record;
    }
    case "regexp":
      return new RegExp(value.pattern, value.flags);
    case "native-object":
      return uncertainNativeObjects.has(value.value) ? UNCERTAIN : value.value;
    case "global":
      return value.name === "document" && host !== null ? host.document : UNCERTAIN;
    default:
      return UNCERTAIN;
  }
};

/** The JavaScript values `args` stand for; null when any part of one is uncertain. */
export const toNativeArguments = (
  args: StaticValue[],
  host: HostDocument | null,
): unknown[] | null => {
  const natives: unknown[] = [];
  for (const argument of args) {
    const native = toNative(argument, host);
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
  host: HostDocument | null,
  onUncertain: NativeCallFallback,
): StaticValue =>
  nativeFunction(name, (args, tools) => {
    const natives = toNativeArguments(args, host);
    if (natives === null) {
      for (const argument of args) tools.markEscaped(argument);
      return onUncertain(args);
    }
    try {
      return fromNativeValue(Reflect.apply(callee, thisValue, natives), `${name}()`, host);
    } catch (error) {
      return unknownValue(`${name}() threw: ${describeError(error)}`);
    }
  });

const isReactElementTag = (tag: unknown): boolean =>
  typeof tag === "symbol" &&
  tag.description !== undefined &&
  REACT_ELEMENT_SYMBOL_KEYS.has(tag.description);

const liftProperties = (
  value: object,
  name: string,
  host: HostDocument | null,
  ancestors: ReadonlySet<object>,
): StaticObjectEntry[] =>
  Object.entries(value).map(([key, item]): StaticObjectEntry => ({
    kind: "property",
    key,
    value: liftValue(item, `${name}.${key}`, host, ancestors),
  }));

const liftObject = (
  value: object,
  name: string,
  host: HostDocument | null,
  ancestors: ReadonlySet<object>,
): StaticValue => {
  if (ancestors.has(value)) return unknownValue(`${name}: cyclic native value`);
  const path = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return listValue(value.map((item, index) => liftValue(item, `${name}[${index}]`, host, path)));
  }
  if (value instanceof Date) return nativeObjectValue(value, null);
  if (host !== null) {
    if (value === host.document) return { kind: "global", name: "document" };
    if (value === host.globalObject) return { kind: "global", name: GLOBAL_INTERFACE_NAME };
    if (host.ownsObject(value)) return nativeObjectValue(value, host);
  }
  if (value instanceof RegExp) {
    return { kind: "regexp", pattern: value.source, flags: value.flags, lastIndex: 0 };
  }
  if (!isPlainObject(value)) {
    return unknownValue(`${name}: ${getNativeInterfaceName(value)} from native code`);
  }
  if (isReactElementTag(Reflect.get(value, "$$typeof"))) {
    const type: unknown = Reflect.get(value, "type");
    const key: unknown = Reflect.get(value, "key");
    const props: unknown = Reflect.get(value, "props");
    if (typeof type !== "string" || typeof props !== "object" || props === null) {
      return unknownValue(`${name}: React element of a non-host type from native code`);
    }
    return element(
      { kind: "host", tagName: type },
      objectValue(liftProperties(props, `${name}.props`, host, path)),
      typeof key === "string" ? primitiveValue(key) : null,
    );
  }
  return objectValue(liftProperties(value, name, host, path));
};

const liftValue = (
  value: unknown,
  name: string,
  host: HostDocument | null,
  ancestors: ReadonlySet<object>,
): StaticValue => {
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
      return pureNativeFunction(name, value, undefined, host, () =>
        unknownValue(`${name}() on dynamic arguments`),
      );
    case "object":
      return value === null ? primitiveValue(null) : liftObject(value, name, host, ancestors);
  }
};

/** `value`, as native code produced it, in the interpreter's terms; `host` owns any document objects among it. */
export const fromNativeValue = (
  value: unknown,
  name: string,
  host: HostDocument | null,
): StaticValue => liftValue(value, name, host, new Set());

const describeMember = (object: StaticNativeObjectValue, key: string): string =>
  `${getNativeInterfaceName(object.value)}.${key}`;

/**
 * A property of a native object, with methods bound so they run natively when
 * called. Mutators run on the analysis' own copy, mirroring the runtime; once
 * one runs with arguments the analysis cannot see, the object is unknown.
 */
export const getNativeObjectMember = (
  object: StaticNativeObjectValue,
  key: string,
): StaticValue => {
  const name = describeMember(object, key);
  const expando = expandoProperties.get(object.value)?.get(key);
  if (expando) return expando;
  if (uncertainNativeObjects.has(object.value)) {
    return unknownValue(`${name} after a mutation on dynamic arguments`);
  }
  if (EVENT_LISTENER_METHODS.has(key)) return { kind: "method", receiver: object, name: key };
  let member: unknown;
  try {
    member = Reflect.get(object.value, key);
  } catch (error) {
    return unknownValue(`${name} threw: ${describeError(error)}`);
  }
  if (LAYOUT_MEMBERS.has(key)) {
    return typeof member === "function"
      ? nativeFunction(name, () => unknownValue(`${name}() depends on layout`))
      : unknownPrimitiveValue("number", `${name} depends on layout`);
  }
  if (typeof member !== "function") return fromNativeValue(member, name, object.host);
  return pureNativeFunction(name, member, object.value, object.host, () => {
    if (!isPureMethodName(key)) uncertainNativeObjects.add(object.value);
    return unknownValue(`${name}() on dynamic arguments`);
  });
};

/**
 * `object.key = value`: native properties take the native form of a known
 * value (a dynamic one makes the object unknown); any other key is an expando
 * kept on the interpreter's side.
 */
export const setNativeObjectMember = (
  object: StaticNativeObjectValue,
  key: string,
  value: StaticValue,
): void => {
  if (key in object.value || getNativeInterfaceName(object.value) === "DOMStringMap") {
    const native = toNative(value, object.host);
    if (native === UNCERTAIN) uncertainNativeObjects.add(object.value);
    else Reflect.set(object.value, key, native);
    return;
  }
  let expandos = expandoProperties.get(object.value);
  if (!expandos) {
    expandos = new Map();
    expandoProperties.set(object.value, expandos);
  }
  expandos.set(key, value);
};

export const deleteNativeObjectMember = (object: StaticNativeObjectValue, key: string): void => {
  expandoProperties.get(object.value)?.delete(key);
};

export const hasNativeObjectMember = (object: StaticNativeObjectValue, key: string): boolean =>
  expandoProperties.get(object.value)?.has(key) === true || key in object.value;

/** What `for..of`, spread and `Array.from` see of a native iterable (`NodeList`, `DOMTokenList`); null for other objects. */
export const getNativeIterableItems = (object: StaticNativeObjectValue): StaticListValue | null => {
  if (uncertainNativeObjects.has(object.value) || !isIterable(object.value)) return null;
  const name = getNativeInterfaceName(object.value);
  return listValue(
    Array.from(object.value, (item, index) =>
      fromNativeValue(item, `${name}[${index}]`, object.host),
    ),
  );
};

/** `value instanceof Interface` against the constructor the object's own document installed; null when it has none by that name. */
export const isNativeInstanceOf = (
  object: StaticNativeObjectValue,
  interfaceName: string,
): boolean | null => object.host?.isInstanceOf(object.value, interfaceName) ?? null;

const NATIVE_CONSTRUCTORS = { Date, ArrayBuffer, DataView } satisfies Record<string, Function>;

export type NativeConstructorName = keyof typeof NATIVE_CONSTRUCTORS;

export const isNativeConstructorName = (name: string): name is NativeConstructorName =>
  Object.hasOwn(NATIVE_CONSTRUCTORS, name);

/** `new <name>(...args)` run natively; null when an argument is uncertain or the construction throws. */
export const constructNativeObject = (
  name: NativeConstructorName,
  args: StaticValue[],
): StaticValue | null => {
  const natives = toNativeArguments(args, null);
  if (natives === null) return null;
  try {
    return fromNativeValue(Reflect.construct(NATIVE_CONSTRUCTORS[name], natives), name, null);
  } catch {
    return null;
  }
};

const DOCUMENT_NATIVE_MEMBERS = new Set([
  "body",
  "documentElement",
  "head",
  "activeElement",
  "childNodes",
  "children",
  "firstChild",
  "lastChild",
  "firstElementChild",
  "lastElementChild",
  "nodeType",
  "nodeName",
  "compatMode",
  "characterSet",
  "createElement",
  "createElementNS",
  "createTextNode",
  "createComment",
  "createDocumentFragment",
  "createRange",
  "getSelection",
  "contains",
  "importNode",
  "adoptNode",
]);

/** Queries the page's own markup answers; the static document only holds what React rendered, so an empty answer is a guess. */
const DOCUMENT_QUERY_METHODS = new Set([
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "getElementsByTagName",
  "getElementsByClassName",
  "getElementsByName",
]);

const WINDOW_NATIVE_MEMBERS = new Set(["getSelection"]);

const isEmptyQueryResult = (value: unknown): boolean =>
  value === null ||
  (typeof value === "object" && value !== null && Reflect.get(value, "length") === 0);

/**
 * A member of `document` or the global object (`objectPath` empty) served by the
 * host document React renders into, so nodes, ranges and selections the program
 * creates are the real ones; null for members the interpreter models itself.
 */
export const getHostDocumentMember = (
  host: HostDocument,
  objectPath: string,
  member: string,
): StaticValue | null => {
  const isDocument = objectPath === "document";
  if (!isDocument && objectPath !== "") return null;
  const target = isDocument ? host.document : host.globalObject;
  const name = isDocument ? `document.${member}` : member;
  if (isDocument && DOCUMENT_QUERY_METHODS.has(member)) {
    const query: unknown = Reflect.get(target, member);
    if (typeof query !== "function") return null;
    return nativeFunction(name, (args) => {
      const natives = toNativeArguments(args, host);
      if (natives === null) return unknownValue(`${name}() on dynamic arguments`);
      const found: unknown = Reflect.apply(query, target, natives);
      return isEmptyQueryResult(found)
        ? unknownValue(`${name}() finds nothing in the static document`)
        : fromNativeValue(found, `${name}()`, host);
    });
  }
  if (!(isDocument ? DOCUMENT_NATIVE_MEMBERS : WINDOW_NATIVE_MEMBERS).has(member)) return null;
  const value: unknown = Reflect.get(target, member);
  if (value === undefined) return null;
  return typeof value === "function"
    ? pureNativeFunction(name, value, target, host, () =>
        unknownValue(`${name}() on dynamic arguments`),
      )
    : fromNativeValue(value, name, host);
};
