import { describeError } from "../errors.js";
import type {
  StaticListValue,
  StaticNativeFunctionValue,
  StaticNativeObjectValue,
  StaticObjectEntry,
  StaticUnknownPrimitiveValue,
  StaticValue,
  StringComposition,
  StubRenderTools,
} from "../types.js";
import { element, nativeFunction } from "./stubs.js";
import type { HostDocument } from "../host/host-document.js";
import type { HostRealm } from "../host/host-realm.js";
import { GLOBAL_INTERFACE_NAME, type HostMember } from "../host/realm-table.js";
import { REACT_ELEMENT_SYMBOL_KEYS } from "../react/element-shape.js";
import { EVENT_LISTENER_METHODS } from "./event-listeners.js";
import { bytesValue, isTypedArrayName, toNativeBinary } from "./typed-arrays.js";
import { isUrlValue, toNativeUrl } from "./url.js";
import {
  branchValue,
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isSameComposition,
  listValue,
  matchesComposition,
  mayOverlapCompositions,
  nativeObjectValue,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const UNCERTAIN = Symbol("uncertain");

/** Native objects a mutator was called on with arguments the analysis could not see. */
const uncertainNativeObjects = new WeakSet<object>();

/** Properties the program adds to DOM nodes (`node.__lexicalKey`): interpreter values that never reach the native object. */
const expandoProperties = new WeakMap<object, Map<string, StaticValue>>();

/** Expandos written under a key composed from a dynamic string (`node[\`__lexicalKey_${editorKey}\`]`). */
const composedExpandoProperties = new WeakMap<object, ComposedExpando[]>();

interface ComposedExpando {
  key: StringComposition;
  value: StaticValue;
}

const hasMemberMatching = (
  object: StaticNativeObjectValue,
  composition: StringComposition,
): boolean => {
  for (const name of expandoProperties.get(object.value)?.keys() ?? []) {
    if (matchesComposition(name, composition)) return true;
  }
  for (
    let prototype: object | null = object.value;
    prototype !== null;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (
      Reflect.ownKeys(prototype).some(
        (name) => typeof name === "string" && matchesComposition(name, composition),
      )
    )
      return true;
  }
  return false;
};

const findComposedExpando = (
  object: StaticNativeObjectValue,
  composition: StringComposition,
): ComposedExpando | undefined =>
  composedExpandoProperties
    .get(object.value)
    ?.find((expando) => isSameComposition(expando.key, composition));

const getOverlappingComposedExpandos = (
  object: StaticNativeObjectValue,
  composition: StringComposition,
): ComposedExpando[] =>
  (composedExpandoProperties.get(object.value) ?? []).filter((expando) =>
    mayOverlapCompositions(expando.key, composition),
  );

const mayReadComposedExpando = (object: StaticNativeObjectValue, name: string): boolean =>
  composedExpandoProperties
    .get(object.value)
    ?.some((expando) => matchesComposition(name, expando.key)) === true;

/** Members by name and the interfaces declaring them, from `Interface.member` entries. */
const classifyMembers = (entries: string[]): ReadonlyMap<string, string[]> => {
  const byMember = new Map<string, string[]>();
  for (const entry of entries) {
    const separator = entry.lastIndexOf(".");
    const memberName = entry.slice(separator + 1);
    byMember.set(memberName, [...(byMember.get(memberName) ?? []), entry.slice(0, separator)]);
  }
  return byMember;
};

/** Whether the realm declares `interfaceName` to inherit `memberName` from an interface the classification names. */
const isClassifiedMember = (
  realm: HostRealm,
  classification: ReadonlyMap<string, string[]>,
  interfaceName: string,
  memberName: string,
): boolean =>
  classification
    .get(memberName)
    ?.some((declaringInterface) => realm.isSubtype(interfaceName, declaringInterface)) === true;

/**
 * Members whose runtime value depends on layout, which the static document
 * never performs: every box is zero-sized here, so reading one is a guess.
 */
export const LAYOUT_MEMBERS = classifyMembers([
  "Element.getBoundingClientRect",
  "Element.getClientRects",
  "Element.checkVisibility",
  "Element.clientWidth",
  "Element.clientHeight",
  "Element.clientTop",
  "Element.clientLeft",
  "Element.scrollWidth",
  "Element.scrollHeight",
  "Element.scrollTop",
  "Element.scrollLeft",
  "HTMLElement.offsetWidth",
  "HTMLElement.offsetHeight",
  "HTMLElement.offsetTop",
  "HTMLElement.offsetLeft",
  "HTMLElement.offsetParent",
  "Range.getBoundingClientRect",
  "Range.getClientRects",
  "DocumentOrShadowRoot.elementFromPoint",
  "DocumentOrShadowRoot.elementsFromPoint",
  "Document.caretRangeFromPoint",
  "Document.caretPositionFromPoint",
]);

/** Canvas members whose value comes from rasterizing, which the static document only answers with placeholders. */
export const RASTER_MEMBERS = classifyMembers([
  "HTMLCanvasElement.getContext",
  "HTMLCanvasElement.toDataURL",
  "HTMLCanvasElement.toBlob",
  "HTMLCanvasElement.captureStream",
  "HTMLCanvasElement.transferControlToOffscreen",
]);

/**
 * Declarations do not say whether a method mutates its receiver; a method
 * named like an accessor is trusted to leave it as it was, any other one run
 * on arguments the analysis cannot see makes the receiver unknown.
 */
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
  "format",
  "select",
  "resolvedOptions",
];

/** The interface name of a native object, read off its prototype: a `Proxy` over a DOM map (`dataset`) answers `constructor` as a lookup. */
export const getNativeInterfaceName = (value: object): string => {
  const prototype = Reflect.getPrototypeOf(value);
  const constructor: unknown =
    prototype === null ? undefined : Reflect.get(prototype, "constructor");
  if (typeof constructor === "function" && constructor.name) return constructor.name;
  return Object.prototype.toString.call(value).slice("[object ".length, -1);
};

/** Immutable `Intl` services whose output depends on locale data alone (not the clock or time zone). */
const INTL_CONSTRUCTORS = {
  "Intl.Collator": Intl.Collator,
  "Intl.ListFormat": Intl.ListFormat,
  "Intl.PluralRules": Intl.PluralRules,
  "Intl.RelativeTimeFormat": Intl.RelativeTimeFormat,
};

const isIntlObject = (value: object): boolean =>
  Object.values(INTL_CONSTRUCTORS).some((constructor) => value instanceof constructor);

const isIterable = (value: object): value is Iterable<unknown> =>
  typeof Reflect.get(value, Symbol.iterator) === "function";

const isPureMethodName = (name: string): boolean =>
  PURE_METHOD_PREFIXES.some((prefix) => name.startsWith(prefix));

const toNative = (value: StaticValue, host: HostDocument | null): unknown => {
  switch (value.kind) {
    case "primitive":
      return value.value;
    case "list": {
      const binary = toNativeBinary(value);
      if (binary !== null) return binary;
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
      if (isUrlValue(value)) return toNativeUrl(value) ?? UNCERTAIN;
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

const guardNativeCall = (name: string, call: () => StaticValue): StaticValue => {
  try {
    return call();
  } catch (error) {
    return unknownValue(`${name}() threw: ${describeError(error)}`);
  }
};

interface NativeCallFallback {
  (args: StaticValue[]): StaticValue;
}

/** Items a callee appended to an array argument (`pathToRegexp(path, keys)`), written back to the list it stood for. */
const writeBackAppendedItems = (
  args: StaticValue[],
  natives: unknown[],
  name: string,
  host: HostDocument | null,
  tools: StubRenderTools,
): void => {
  args.forEach((argument, index) => {
    const native = natives[index];
    if (argument.kind !== "list" || !Array.isArray(native)) return;
    const appended = native
      .slice(argument.items.length)
      .map((item, offset) =>
        fromNativeValue(item, `${name}()[${argument.items.length + offset}]`, host),
      );
    if (appended.length > 0) tools.pushItems(argument, appended);
  });
};

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
): StaticNativeFunctionValue => ({
  kind: "native-function",
  name,
  call: (args, tools) => {
    const natives = toNativeArguments(args, host);
    if (natives === null) {
      for (const argument of args) tools.markEscaped(argument);
      return onUncertain(args);
    }
    return guardNativeCall(name, () => {
      const result = fromNativeValue(Reflect.apply(callee, thisValue, natives), `${name}()`, host);
      writeBackAppendedItems(args, natives, name, host, tools);
      return result;
    });
  },
  getOwnProperty: (key) =>
    Object.prototype.propertyIsEnumerable.call(callee, key)
      ? fromNativeValue(Reflect.get(callee, key), `${name}.${key}`, host)
      : undefined,
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
  if (value instanceof Date || value instanceof DataView || isIntlObject(value)) {
    return nativeObjectValue(value, null);
  }
  if (value instanceof ArrayBuffer) return bytesValue("ArrayBuffer", new Uint8Array(value));
  const interfaceName = getNativeInterfaceName(value);
  if (ArrayBuffer.isView(value) && isTypedArrayName(interfaceName)) {
    return bytesValue(
      interfaceName,
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  if (host !== null) {
    if (value === host.document) return { kind: "global", name: "document" };
    if (value === host.globalObject) return { kind: "global", name: GLOBAL_INTERFACE_NAME };
    if (host.ownsObject(value)) return nativeObjectValue(value, host);
  }
  if (value instanceof RegExp) {
    return { kind: "regexp", pattern: value.source, flags: value.flags, lastIndex: 0 };
  }
  if (!isPlainObject(value)) return unknownValue(`${name}: ${interfaceName} from native code`);
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
  if (mayReadComposedExpando(object, key)) {
    return unknownValue(`${name} may be a property written under a dynamic key`);
  }
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
  if (object.host !== null) {
    const declared = getDeclaredMember(object.host.realm, object.value, key);
    if (declared !== null) {
      const classified = getClassifiedMember(object.host.realm, declared, name);
      if (classified) return classified;
      if (member === undefined) {
        return unknownValue(`${name} is not implemented by the static document`);
      }
    }
  }
  if (typeof member !== "function") return fromNativeValue(member, name, object.host);
  return pureNativeFunction(name, member, object.value, object.host, () => {
    if (!isPureMethodName(key)) uncertainNativeObjects.add(object.value);
    return unknownValue(`${name}() on dynamic arguments`);
  });
};

interface DeclaredMember {
  interfaceName: string;
  memberName: string;
  member: HostMember;
}

/** What the host's declarations say of a member of a native object; null for objects of no declared interface. */
const getDeclaredMember = (realm: HostRealm, value: object, key: string): DeclaredMember | null => {
  const interfaceName = getNativeInterfaceName(value);
  const member = realm.getMember(interfaceName, key);
  return member === null ? null : { interfaceName, memberName: key, member };
};

/**
 * The stand-in for a member the static document cannot answer (layout,
 * rasterization), shaped by its declared kind; null for members it answers.
 */
const getClassifiedMember = (
  realm: HostRealm,
  { interfaceName, memberName, member }: DeclaredMember,
  name: string,
): StaticValue | null => {
  if (isClassifiedMember(realm, LAYOUT_MEMBERS, interfaceName, memberName)) {
    if (member.type.kind === "function") {
      return nativeFunction(name, () => unknownValue(`${name}() depends on layout`));
    }
    return member.type.kind === "number"
      ? unknownPrimitiveValue("number", `${name} depends on layout`)
      : unknownValue(`${name} depends on layout`);
  }
  if (
    member.type.kind === "function" &&
    isClassifiedMember(realm, RASTER_MEMBERS, interfaceName, memberName)
  ) {
    return nativeFunction(name, () => unknownValue(`${name}() depends on rasterization`));
  }
  return null;
};

const isLayoutMember = (object: StaticNativeObjectValue, key: string): boolean =>
  object.host !== null &&
  isClassifiedMember(object.host.realm, LAYOUT_MEMBERS, getNativeInterfaceName(object.value), key);

/**
 * `object.key = value`: native properties take the native form of a known
 * value (a dynamic one makes the object unknown, except layout state, which
 * reads as unknown regardless); any other key is an expando kept on the
 * interpreter's side.
 */
export const setNativeObjectMember = (
  object: StaticNativeObjectValue,
  key: string,
  value: StaticValue,
): void => {
  if (isLayoutMember(object, key)) return;
  if (key in object.value || getNativeInterfaceName(object.value) === "DOMStringMap") {
    const native = toNative(value, object.host);
    if (native !== UNCERTAIN) Reflect.set(object.value, key, native);
    else if (!LAYOUT_MEMBERS.has(key)) uncertainNativeObjects.add(object.value);
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

export const getNativeObjectComposedMember = (
  object: StaticNativeObjectValue,
  key: StaticUnknownPrimitiveValue,
): StaticValue => {
  const name = `${getNativeInterfaceName(object.value)}[${key.reason}]`;
  if (!key.composition) return unknownValue(`${name}: dynamic key`);
  const expando = findComposedExpando(object, key.composition);
  if (expando) return expando.value;
  if (uncertainNativeObjects.has(object.value)) {
    return unknownValue(`${name} after a mutation on dynamic arguments`);
  }
  const overlapping = getOverlappingComposedExpandos(object, key.composition);
  if (overlapping.length > 0 || hasMemberMatching(object, key.composition)) {
    return unknownValue(`${name}: dynamic key`);
  }
  return UNDEFINED_VALUE;
};

export const setNativeObjectComposedMember = (
  object: StaticNativeObjectValue,
  key: StaticUnknownPrimitiveValue,
  value: StaticValue,
): void => {
  if (!key.composition || hasMemberMatching(object, key.composition)) {
    uncertainNativeObjects.add(object.value);
    return;
  }
  const expando = findComposedExpando(object, key.composition);
  if (expando) {
    expando.value = value;
    return;
  }
  for (const overlapping of getOverlappingComposedExpandos(object, key.composition)) {
    overlapping.value = branchValue(
      [overlapping.value, value],
      "a write under a dynamic key may have replaced it",
    );
  }
  let expandos = composedExpandoProperties.get(object.value);
  if (!expandos) {
    expandos = [];
    composedExpandoProperties.set(object.value, expandos);
  }
  expandos.push({ key: key.composition, value });
};

export const deleteNativeObjectComposedMember = (
  object: StaticNativeObjectValue,
  key: StaticUnknownPrimitiveValue,
): void => {
  const expandos = composedExpandoProperties.get(object.value);
  if (!expandos) return;
  if (!key.composition) {
    if (expandos.length > 0) uncertainNativeObjects.add(object.value);
    return;
  }
  const index = expandos.findIndex((expando) => isSameComposition(expando.key, key.composition));
  if (index !== -1) expandos.splice(index, 1);
};

export const hasNativeObjectMember = (
  object: StaticNativeObjectValue,
  key: string | symbol,
): boolean =>
  (typeof key === "string" && expandoProperties.get(object.value)?.has(key) === true) ||
  key in object.value;

/** What `Object.keys`/`entries` see of a native object; null once a mutation on dynamic arguments ran. */
export const getNativeOwnEntries = (
  object: StaticNativeObjectValue,
): [key: string, value: StaticValue][] | null => {
  if (
    uncertainNativeObjects.has(object.value) ||
    (composedExpandoProperties.get(object.value)?.length ?? 0) > 0
  )
    return null;
  const name = getNativeInterfaceName(object.value);
  return [
    ...Object.entries(object.value).map(([key, item]): [string, StaticValue] => [
      key,
      fromNativeValue(item, `${name}.${key}`, object.host),
    ]),
    ...(expandoProperties.get(object.value) ?? []),
  ];
};

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

/**
 * Language constructors run natively because their result is a pure function
 * of their arguments (and locale data): declarations say these exist, not
 * that they are deterministic, which is why the list is kept by hand.
 */
const NATIVE_CONSTRUCTORS = {
  Date,
  ArrayBuffer,
  DataView,
  ...INTL_CONSTRUCTORS,
} satisfies Record<string, Function>;

type NativeConstructorName = keyof typeof NATIVE_CONSTRUCTORS;

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

/**
 * `Document` members the static document answers like a fresh page's: its tree
 * roots and node factories, parser facts, and the focus and selection nothing
 * has touched. Page state (`cookie`, `title`, `readyState`) stays modeled.
 */
export const DOCUMENT_SERVED_MEMBERS = new Set([
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

/** `Window` members the host window answers for a freshly loaded page at the configured viewport. */
export const WINDOW_SERVED_MEMBERS = new Set([
  "getSelection",
  "innerWidth",
  "innerHeight",
  "outerWidth",
  "outerHeight",
  "devicePixelRatio",
  "pageXOffset",
  "pageYOffset",
  "scrollX",
  "scrollY",
]);

/** A method declared to answer with the nodes it finds: a nullable node or a node collection. */
const isTreeQuery = (realm: HostRealm, member: HostMember): boolean => {
  const { returnType } = member;
  if (member.type.kind !== "function" || returnType === null || returnType.interfaceName === null)
    return false;
  return returnType.isNullable
    ? realm.isSubtype(returnType.interfaceName, "Node")
    : realm.isSubtype(returnType.interfaceName, "NodeList") ||
        realm.isSubtype(returnType.interfaceName, "HTMLCollectionBase");
};

/** `new Image(width, height)`: the `<img>` of the host document it constructs, as `document.createElement("img")` would; null for dynamic arguments. */
export const constructHostImage = (host: HostDocument, args: StaticValue[]): StaticValue | null => {
  const constructor: unknown = Reflect.get(host.globalObject, "Image");
  const natives = toNativeArguments(args, host);
  if (typeof constructor !== "function" || natives === null) return null;
  return guardNativeCall("new Image", () =>
    fromNativeValue(Reflect.construct(constructor, natives), "new Image()", host),
  );
};

const isEmptyQueryResult = (value: unknown): boolean =>
  value === null ||
  (typeof value === "object" && value !== null && Reflect.get(value, "length") === 0);

const hostDocumentValue = (host: HostDocument): StaticNativeObjectValue =>
  nativeObjectValue(host.document, host);

export const hasHostDocumentMember = (host: HostDocument, member: string): boolean =>
  hasNativeObjectMember(hostDocumentValue(host), member);

export const getHostDocumentExpando = (host: HostDocument, member: string): StaticValue | null =>
  expandoProperties.get(host.document)?.get(member) ?? null;

export const setHostDocumentMember = (
  host: HostDocument,
  member: string,
  value: StaticValue,
): void => setNativeObjectMember(hostDocumentValue(host), member, value);

/**
 * A member of `document` or the global object (`objectPath` empty) served by the
 * host document React renders into, so nodes, ranges and selections the program
 * creates are the real ones; null for members the interpreter models itself.
 * Without the page's HTML shell the static document only holds what React
 * rendered, so a tree query finding nothing is a guess.
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
  const declared = getDeclaredMember(host.realm, target, member);
  if (declared === null) return null;
  const isQuery = isDocument && isTreeQuery(host.realm, declared.member);
  if (!isQuery && !(isDocument ? DOCUMENT_SERVED_MEMBERS : WINDOW_SERVED_MEMBERS).has(member))
    return null;
  const classified = getClassifiedMember(host.realm, declared, name);
  if (classified) return classified;
  const value: unknown = Reflect.get(target, member);
  if (value === undefined) return null;
  if (declared.member.type.kind !== "function") return fromNativeValue(value, name, host);
  if (typeof value !== "function") return null;
  if (!isQuery) {
    return pureNativeFunction(name, value, target, host, () =>
      unknownValue(`${name}() on dynamic arguments`),
    );
  }
  return nativeFunction(name, (args) => {
    const natives = toNativeArguments(args, host);
    if (natives === null) return unknownValue(`${name}() on dynamic arguments`);
    return guardNativeCall(name, () => {
      const found: unknown = Reflect.apply(value, target, natives);
      return isEmptyQueryResult(found) && !host.hasKnownMarkup
        ? unknownValue(`${name}() finds nothing in the static document`)
        : fromNativeValue(found, `${name}()`, host);
    });
  });
};
