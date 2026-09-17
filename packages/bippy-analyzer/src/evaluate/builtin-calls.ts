import type { HostDocument } from "../host/host-document.js";
import type { HostRealm } from "../host/host-realm.js";
import type { SourceLocation } from "../parse/source-types.js";
import type {
  StaticAccessor,
  StaticElementValue,
  StaticFunctionValue,
  StaticGlobalValue,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticPropertyEntry,
  StaticValue,
} from "../types.js";
import { createAbortController } from "./abort-controller.js";
import {
  arrayOfLength,
  callArrayMethod,
  groupItems,
  iterableOrArrayLike,
  mapList,
} from "./array-methods.js";
import { createBlobValue } from "./blob.js";
import {
  callHotModuleMethod,
  getBundlerGlobal,
  type EnvironmentLookup,
} from "./bundler-globals.js";
import { getClassPrototypeObject } from "./class-component.js";
import { createClockDateValue, isClockReading } from "./clock-date.js";
import { createCollectionValue, getCollectionItems } from "./collections.js";
import type { EvaluationContext } from "./context.js";
import { createDomObserver, isDomObserverName } from "./dom-observers.js";
import { createErrorValue, isErrorConstructorName } from "./errors.js";
import { callEventTargetMethod } from "./event-listeners.js";
import { callFetch } from "./fetch.js";
import { constructFunctionFromSource } from "./function-constructor.js";
import { hasProperty, isIntrinsicFunctionKey, ownsNoFunctionTextKey } from "./has-property.js";
import { getHostGlobal, getLanguageMethodResult, GLOBAL_OBJECT_VALUE } from "./host-globals.js";
import { createImageElement, type ImageLoadHost } from "./image-loading.js";
import { callImportMetaGlob } from "./import-glob.js";
import { callIndexedDbMethod, isIndexedDbName, type IndexedDbHost } from "./indexed-db.js";
import { getBuiltinPrototypeName, getPrototypeWitness, isPrototypeOf } from "./instance-of.js";
import type { Interpreter } from "./interpreter.js";
import { createNumberFormat } from "./intl-format.js";
import { getLanguageObject, toLanguagePropertyKey } from "./language-intrinsics.js";
import { mediaQueryListValue } from "./media-query.js";
import {
  bindCallbackThisArg,
  isListPreservingMethod,
  isPromiseMethodName,
} from "./method-signatures.js";
import {
  constructHostNode,
  constructNativeObject,
  fromNativeValue,
  getNativeOwnEntries,
  isHostNodeConstructorName,
  isNativeConstructorName,
  toNativeArguments,
  toNativeObjectPrimitive,
} from "./native-values.js";
import { applyMathToRanges, rangedNumberValue } from "./number-ranges.js";
import { getObjectTag } from "./object-tag.js";
import { recordInputSource } from "./predicates.js";
import {
  callShapedPrimitiveMethod,
  getFunctionText,
  isFunctionText,
  quoteUnknownString,
  toPropertyKey,
  toStringValue,
} from "./primitive-shapes.js";
import {
  chainPromise,
  combinePromises,
  createPromiseValue,
  getModeledPromise,
  isThrownOutcome,
  resolvedPromiseValue,
  type PromiseHandlers,
  type PromiseTools,
} from "./promises.js";
import { isBaseClassPrototype, isClassPrototype } from "./prototype-owners.js";
import { callRequireContext } from "./require-context.js";
import { memoizeScalarOperation } from "./scalar-memo.js";
import { callHistoryMethod, isHistoryName } from "./session-history.js";
import {
  callNumberMethod,
  callRegExpMethod,
  callStringMethod,
  dynamicSplitResult,
} from "./string-methods.js";
import { nativeFunction } from "./stubs.js";
import {
  callStringCodec,
  createBufferValue,
  createTextDecoder,
  createTextEncoder,
  getBufferByteLength,
  isStringCodecName,
} from "./text-encoding.js";
import { isArrayValue } from "./type-predicates.js";
import {
  binaryFromItems,
  constructBinary,
  isBinaryView,
  isTypedArrayName,
} from "./typed-arrays.js";
import { createSearchParamsValue } from "./url-search-params.js";
import { createUrlValue } from "./url.js";
import { isPrimitiveBranch, MAX_DISTRIBUTED_ALTERNATIVES } from "./value-distribution.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  accessorEntry,
  branchValue,
  compareIdentity,
  createRegisteredSymbolValue,
  createSymbolValue,
  describeValue,
  distributeObjectBranches,
  FALSE_VALUE,
  getClassPrototype,
  getKnownObjectKeys,
  getKnownObjectOwnNames,
  getKnownObjectSymbols,
  getOwnEnumerableEntries as getModeledOwnEnumerableEntries,
  getObjectProperty,
  getOwnPropertyDescriptor,
  getOwnPropertyPresence,
  getPropertyName,
  getSymbolPropertyKey,
  getTruthiness,
  hasDefiniteItems,
  isCallable,
  isKnownList,
  isNullish,
  isSymbolPropertyKey,
  jsonValue,
  listValue,
  mapValue,
  nativeObjectValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  spreadListItems,
  thrownValue,
  toBooleanValue,
  toJsonValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";
import { callWebCryptoMethod, isWebCryptoName } from "./web-crypto.js";
import { callStorageMethod, getStorageAreaName } from "./web-storage.js";

const NUMBER_PREDICATES: Record<string, (value: StaticPrimitive) => boolean> = {
  "Number.isNaN": Number.isNaN,
  "Number.isFinite": Number.isFinite,
  "Number.isInteger": Number.isInteger,
  "Number.isSafeInteger": Number.isSafeInteger,
};

/** A fresh deep copy of plain data (primitives, arrays, plain objects); null when some part is not statically cloneable. */
const structuredCloneValue = (value: StaticValue): StaticValue | null => {
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "symbol" ? null : value;
    case "list": {
      if (!hasDefiniteItems(value)) return null;
      const items = value.items.map(structuredCloneValue);
      return items.every((item) => item !== null) ? listValue(items) : null;
    }
    case "object": {
      if (
        getCollectionItems(value) ||
        value.entries.some((entry) => entry.kind === "property" && entry.accessor)
      )
        return null;
      const keys = getKnownObjectKeys(value);
      if (keys === null) return null;
      const entries: StaticObjectEntry[] = [];
      for (const key of keys) {
        const cloned = structuredCloneValue(getObjectProperty(value, key));
        if (cloned === null) return null;
        entries.push({ kind: "property", key, value: cloned });
      }
      return objectValue(entries);
    }
    default:
      return null;
  }
};

/**
 * The object entry one `Object.fromEntries` pair contributes: a pair that may
 * be absent or take several shapes becomes a spread over the objects it could
 * produce (including `{}`), so later reads stay per-key branches.
 */
const getEntryFromPair = (pair: StaticValue): StaticObjectEntry | null => {
  if (pair.kind === "optional") {
    const present = getEntryFromPair(pair.value);
    if (!present) return null;
    return {
      kind: "spread",
      value: branchValue([objectValue([present]), objectValue([])], pair.reason, pair.location),
    };
  }
  if (pair.kind === "branch") {
    const alternatives: StaticObjectEntry[] = [];
    for (const alternative of pair.alternatives) {
      const entry = getEntryFromPair(alternative);
      if (!entry) return null;
      alternatives.push(entry);
    }
    return {
      kind: "spread",
      value: branchValue(
        alternatives.map((entry) => objectValue([entry])),
        pair.reason,
        pair.location,
        pair.preferredIndex,
      ),
    };
  }
  if (!hasDefiniteItems(pair)) return null;
  const [key, value = UNDEFINED_VALUE] = pair.items;
  if (key?.kind !== "primitive") return null;
  return { kind: "property", key: String(key.value), value };
};

/** A global the bundler injects or the host declares; null when the name is undeclared in this host. */
export const getBuiltinGlobal = (
  name: string,
  realm: HostRealm,
  hostDocument: HostDocument | null,
  environment?: EnvironmentLookup,
): StaticValue | null =>
  getBundlerGlobal(name, environment) ?? getHostGlobal(realm, hostDocument, name);

const toNumberValue = (value: StaticValue): StaticValue => {
  if (value.kind === "native-object")
    return toNumberValue(toNativeObjectPrimitive(value, "number"));
  if (
    value.kind === "primitive" &&
    typeof value.value !== "bigint" &&
    typeof value.value !== "symbol"
  ) {
    return primitiveValue(Number(value.value));
  }
  return unknownPrimitiveValue("number", `Number(${describeValue(value)})`);
};

const toStringOfValue = (value: StaticValue): StaticValue =>
  toStringValue(
    mapValue(value, (alternative) =>
      alternative.kind === "native-object"
        ? toNativeObjectPrimitive(alternative, "string")
        : alternative,
    ),
  );

const getDescriptorAccessor = (descriptor: StaticObjectValue): StaticAccessor | null => {
  const keys = getKnownObjectKeys(descriptor);
  if (!keys || keys.includes("value") || !(keys.includes("get") || keys.includes("set")))
    return null;
  return {
    get: keys.includes("get") ? getObjectProperty(descriptor, "get") : null,
    set: keys.includes("set") ? getObjectProperty(descriptor, "set") : null,
  };
};

/**
 * Development builds define `element.ref` as a deprecation-warning getter only
 * when a ref was given (react/src/jsx/ReactJSXElement.js).
 */
const getElementRefDescriptor = (
  element: StaticElementValue,
  location: SourceLocation | null,
): StaticValue => {
  const ref = getObjectProperty(element.props, "ref");
  const descriptor = objectFromRecord({
    get: nativeFunction("elementRefGetterWithDeprecationWarning", () =>
      mapValue(ref, (alternative) =>
        alternative.kind === "primitive" && alternative.value === undefined
          ? NULL_VALUE
          : alternative,
      ),
    ),
    set: UNDEFINED_VALUE,
    enumerable: FALSE_VALUE,
    configurable: FALSE_VALUE,
  });
  return mapValue(ref, (alternative) => {
    switch (isNullish(alternative)) {
      case true:
        return UNDEFINED_VALUE;
      case false:
        return descriptor;
      default:
        return branchValue([UNDEFINED_VALUE, descriptor], "ref prop may be absent", location);
    }
  });
};

/** Function properties hold values only, so an accessor defined on one is read once. */
const readDescriptorValue = (
  interpreter: Interpreter,
  target: StaticValue,
  descriptor: StaticObjectValue,
  key: string,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const keys = getKnownObjectKeys(descriptor);
  if (keys?.includes("value")) return getObjectProperty(descriptor, "value");
  if (keys?.includes("get")) {
    return interpreter.callValue(getObjectProperty(descriptor, "get"), [], context, location, {
      thisValue: target,
    });
  }
  return unknownValue(`property "${key}" defined with a dynamic descriptor`, location);
};

/** A descriptor without `enumerable` defines a non-enumerable property; an undecidable flag is taken as enumerable. */
const isEnumerableDescriptor = (descriptor: StaticObjectValue): boolean =>
  getTruthiness(getObjectProperty(descriptor, "enumerable")) !== false;

/** `Object.defineProperty`; a function's `name` is what fibers display. */
const defineOwnProperty = (
  interpreter: Interpreter,
  target: StaticValue,
  key: string,
  descriptor: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): void => {
  const isEnumerable = isEnumerableDescriptor(descriptor);
  if (target.kind === "object" || target.kind === "list") interpreter.recordHeapMutation(target);
  if (target.kind === "object") {
    const accessor = getDescriptorAccessor(descriptor);
    const entry: StaticPropertyEntry = accessor
      ? accessorEntry(key, accessor, location)
      : {
          kind: "property",
          key,
          value: readDescriptorValue(interpreter, target, descriptor, key, context, location),
        };
    target.entries.push({ ...entry, isEnumerable });
    return;
  }
  const value = readDescriptorValue(interpreter, target, descriptor, key, context, location);
  switch (target.kind) {
    case "function":
    case "class":
      if (key === "name") {
        if (value.kind === "primitive" && typeof value.value === "string")
          target.name = value.value;
        return;
      }
      interpreter.assignOwnProperty(target.properties, key, value);
      return;
    case "react-api":
      interpreter.setReactApiProperty(target.api, key, value, context);
      return;
    case "global":
      interpreter.setGlobalMember(target, key, value, context);
      return;
    case "list": {
      if (target.isFrozen || Number.isInteger(Number(key)) || key === "length") return;
      target.properties ??= new Map();
      target.properties.set(key, value);
      if (!isEnumerable) (target.nonEnumerableKeys ??= new Set()).add(key);
      return;
    }
    default:
      return;
  }
};

const defineOwnProperties = (
  interpreter: Interpreter,
  target: StaticValue,
  descriptors: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): void => {
  for (const key of getKnownObjectKeys(descriptors) ?? []) {
    const descriptor = getObjectProperty(descriptors, key);
    if (descriptor.kind === "object") {
      defineOwnProperty(interpreter, target, key, descriptor, context, location);
    }
  }
};

export const INTRINSIC_PROTOTYPE_NAMES = new Set(["Object.prototype", "Function.prototype"]);

const INTRINSIC_PROTOTYPE_GLOBAL = /^([A-Z]\w*)\.prototype$/;

/**
 * `Object.create(Iterator.prototype)` and the like: an object inheriting an
 * intrinsic prototype the analysis does not model, whose members are unknown
 * rather than absent (tslib's `__generator` builds its iterators this way).
 */
const getIntrinsicPrototypeObject = (globalName: string): StaticObjectValue | null => {
  const constructorName = INTRINSIC_PROTOTYPE_GLOBAL.exec(globalName)?.[1];
  const constructor: unknown = constructorName
    ? Reflect.get(globalThis, constructorName)
    : undefined;
  if (typeof constructor !== "function") return null;
  const prototype: unknown = constructor.prototype;
  if (typeof prototype !== "object" || prototype === null) return null;
  return objectFromRecord(
    Object.fromEntries(
      Object.getOwnPropertyNames(prototype)
        .filter((key) => key !== "constructor")
        .map((key) => [key, unknownValue(`${globalName}.${key}`, null)]),
    ),
  );
};

/** `Object.getOwnPropertyNames(fn)`: the intrinsic names, then the names the analyzed code assigned. */
const getFunctionOwnNames = (callable: StaticFunctionValue): string[] | null => {
  const ownKeys = getKnownObjectOwnNames(callable.properties);
  if (!ownKeys) return null;
  const names = ["length", "name"];
  if (isIntrinsicFunctionKey(callable, "prototype")) names.push("prototype");
  for (const key of ownKeys) {
    if (!names.includes(key) && !isSymbolPropertyKey(key)) names.push(key);
  }
  return names;
};

const getFunctionOwnPropertyDescriptor = (
  interpreter: Interpreter,
  callable: StaticFunctionValue,
  key: string,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const ownNames = getFunctionOwnNames(callable);
  if (!ownNames) return unknownValue(`descriptor of a partially known function`, location);
  if (!ownNames.includes(key)) return UNDEFINED_VALUE;
  const isIntrinsic = isIntrinsicFunctionKey(callable, key);
  return objectFromRecord({
    value: interpreter.getProperty(callable, key, context, location),
    writable: primitiveValue(key === "prototype" || !isIntrinsic),
    enumerable: primitiveValue(!isIntrinsic),
    configurable: primitiveValue(key !== "prototype"),
  });
};

const getOwnPropertyDescriptors = (
  interpreter: Interpreter,
  target: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (target.kind === "function") {
    const names = getFunctionOwnNames(target);
    if (!names) return unknownValue(`descriptors of a partially known function`, location);
    return objectValue(
      names.map((key) => ({
        kind: "property",
        key,
        value: getFunctionOwnPropertyDescriptor(interpreter, target, key, context, location),
      })),
    );
  }
  const ownKeys = target.kind === "object" ? getKnownObjectOwnNames(target) : null;
  if (target.kind !== "object" || !ownKeys) {
    return unknownValue(`Object.getOwnPropertyDescriptors of ${describeValue(target)}`, location);
  }
  const descriptors: StaticObjectEntry[] = [];
  for (const key of ownKeys) {
    const descriptor = getOwnPropertyDescriptor(target, key);
    if (!descriptor) {
      return unknownValue(`Object.getOwnPropertyDescriptors of ${describeValue(target)}`, location);
    }
    descriptors.push({ kind: "property", key, value: descriptor });
  }
  return objectValue(descriptors);
};

/** Own enumerable string-keyed entries in `Object.keys` order; null when the shape is not fully known. */
const getOwnEnumerableEntries = (
  target: StaticValue,
): [key: string, value: StaticValue][] | null =>
  target.kind === "native-object"
    ? getNativeOwnEntries(target)
    : getModeledOwnEnumerableEntries(target);

/** Own string keys including non-enumerable ones; null when the shape is not fully known. */
const getOwnNames = (target: StaticObjectValue | StaticListValue): string[] | null => {
  if (target.kind === "object") return getKnownObjectOwnNames(target);
  if (!hasDefiniteItems(target)) return null;
  return [
    ...target.items.map((_, index) => String(index)),
    "length",
    ...(target.properties?.keys() ?? []),
  ];
};

/** `Object.assign(target, source)`: copies known own keys (strings then symbols), else records the source as a spread. */
const assignOwnEntries = (target: StaticObjectValue, source: StaticValue): void => {
  if (source.kind === "primitive") return;
  const stringKeys = source.kind === "object" ? getKnownObjectKeys(source) : null;
  const symbolKeys = source.kind === "object" ? getKnownObjectSymbols(source) : null;
  if (source.kind !== "object" || !stringKeys || !symbolKeys) {
    target.entries.push({ kind: "spread", value: source });
    return;
  }
  for (const key of [...stringKeys, ...symbolKeys.map(getSymbolPropertyKey)]) {
    target.entries.push({ kind: "property", key, value: getObjectProperty(source, key) });
  }
};

/** `receiver.hasOwnProperty(key)` / `propertyIsEnumerable(key)`; null when the receiver's own keys are not modeled. */
const hasOwnProperty = (
  receiver: StaticValue,
  key: StaticValue,
  name: string,
): StaticValue | null => {
  if (receiver.kind === "namespace" && !receiver.module.isCommonJs && key.kind === "symbol") {
    return primitiveValue(name === "hasOwnProperty" && key.key === "Symbol.toStringTag");
  }
  const propertyName = toPropertyKey(key);
  if (propertyName === null)
    return isFunctionText(key) && ownsNoFunctionTextKey(receiver) ? FALSE_VALUE : null;
  if (receiver.kind === "object" || receiver.kind === "list") {
    if (receiver.kind === "list" && propertyName === "length")
      return primitiveValue(name === "hasOwnProperty");
    if (receiver.kind === "object" && name === "hasOwnProperty") {
      return getOwnPropertyPresence(receiver, propertyName);
    }
    const ownKeys =
      receiver.kind === "object" && isSymbolPropertyKey(propertyName)
        ? getKnownObjectSymbols(receiver)?.map(getSymbolPropertyKey)
        : name === "hasOwnProperty"
          ? getOwnNames(receiver)
          : getOwnEnumerableEntries(receiver)?.map(([ownKey]) => ownKey);
    return ownKeys
      ? primitiveValue(ownKeys.includes(propertyName))
      : unknownPrimitiveValue("boolean", `${name} of a partially known target`);
  }
  if (receiver.kind === "function" || receiver.kind === "class") {
    if (
      isIntrinsicFunctionKey(receiver, propertyName) &&
      (name === "hasOwnProperty" || propertyName === "prototype")
    )
      return primitiveValue(name === "hasOwnProperty");
    const presence = getOwnPropertyPresence(receiver.properties, propertyName);
    if (getTruthiness(presence) !== false) {
      const isClassMember =
        receiver.kind === "class" &&
        receiver.body.members.some(
          (member) =>
            member.isStatic &&
            member.kind !== "field" &&
            member.kind !== "static-block" &&
            member.key === propertyName,
        );
      return name === "hasOwnProperty" || !isClassMember ? presence : FALSE_VALUE;
    }
    return FALSE_VALUE;
  }
  if (receiver.kind === "global") {
    const languageObject = getLanguageObject(receiver.name);
    const propertyKey = toLanguagePropertyKey(propertyName);
    if (languageObject === null || propertyKey === null) return null;
    return primitiveValue(
      name === "hasOwnProperty"
        ? Object.hasOwn(languageObject, propertyKey)
        : Object.prototype.propertyIsEnumerable.call(languageObject, propertyKey),
    );
  }
  return null;
};

/** `Object.getPrototypeOf(value)` for values whose chain is a native one: the builtin prototype global, or null at the chain's end. */
const getWitnessedPrototype = (
  value: StaticValue | undefined,
  name: string,
  location: SourceLocation | null,
): StaticValue => {
  if (value?.kind === "branch")
    return mapValue(value, (alternative) => getWitnessedPrototype(alternative, name, location));
  const witness = value === undefined ? null : getPrototypeWitness(value);
  if (witness === null) return unknownValue(`${name} on a dynamic target`, location);
  const prototype: object | null = Object.getPrototypeOf(witness);
  if (prototype === null) return NULL_VALUE;
  const prototypeName = getBuiltinPrototypeName(prototype);
  return prototypeName === null
    ? unknownValue(`${name} on an instance of an unmodeled builtin`, location)
    : { kind: "global", name: prototypeName };
};

const FUNCTION_INVOCATION_METHODS = new Set(["call", "apply", "bind"]);

/** `Function.prototype.toString.call(value)`: a `TypeError` for non-callables, an unknown string when the text is not statically known. */
const getInvokedFunctionSource = (
  value: StaticValue,
  location: SourceLocation | null,
): StaticValue =>
  mapValue(value, (alternative) => {
    if (alternative.kind === "primitive" || alternative.kind === "symbol")
      return thrownValue(
        "Function.prototype.toString on a non-callable",
        createErrorValue(
          "TypeError",
          [primitiveValue("Function.prototype.toString requires that 'this' be a Function")],
          location,
        ),
        location,
      );
    return (
      getFunctionText(alternative) ??
      unknownPrimitiveValue("string", `source text of ${describeValue(alternative)}`)
    );
  });

const PROTOTYPE_SEGMENT = ".prototype.";

/** A builtin invoked through `Function.prototype`, as compiled helpers do: `Object.assign.apply(this, args)`, `Object.prototype.hasOwnProperty.call(o, k)`. */
const callInvokedGlobal = (
  interpreter: Interpreter,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const separator = name.lastIndexOf(".");
  const invocation = name.slice(separator + 1);
  if (separator === -1 || !FUNCTION_INVOCATION_METHODS.has(invocation)) return null;
  const target = name.slice(0, separator);
  if (target === "Object.prototype.toString" && invocation !== "bind")
    return getObjectTag(args[0] ?? UNDEFINED_VALUE);
  if (target === "Function.prototype.toString" && invocation !== "bind")
    return getInvokedFunctionSource(args[0] ?? UNDEFINED_VALUE, location);
  const prototypeIndex = target.indexOf(PROTOTYPE_SEGMENT);
  const callee: StaticValue =
    prototypeIndex === -1
      ? { kind: "global", name: target }
      : {
          kind: "method",
          receiver: args[0] ?? UNDEFINED_VALUE,
          name: target.slice(prototypeIndex + PROTOTYPE_SEGMENT.length),
        };
  if (invocation === "bind") {
    const boundArgs = args.slice(1);
    if (callee.kind === "global" && boundArgs.length === 0) return callee;
    return nativeFunction(`bound ${target}`, (callArgs, tools) =>
      tools.call(callee, [...boundArgs, ...callArgs]),
    );
  }
  const [, second] = args;
  const calleeArgs =
    invocation === "call"
      ? args.slice(1)
      : second === undefined
        ? []
        : second.kind === "list"
          ? second.items
          : [unknownValue("apply arguments", location)];
  return interpreter.callValue(callee, calleeArgs, context, location);
};

/** `window.addEventListener` splits into the global object and `addEventListener`; `history.pushState` into `history` and `pushState`. */
const splitGlobalName = (name: string): [receiver: StaticValue, memberName: string] => {
  const separator = name.lastIndexOf(".");
  return separator === -1
    ? [GLOBAL_OBJECT_VALUE, name]
    : [{ kind: "global", name: name.slice(0, separator) }, name.slice(separator + 1)];
};

/** Methods of host objects whose state the interpreter models: listeners, media queries, hot modules, history and storage. */
const callHostObjectMethod = (
  interpreter: Interpreter,
  receiver: StaticGlobalValue,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const realm = interpreter.getRealm(context.environment);
  const listened = callEventTargetMethod(
    interpreter,
    realm,
    receiver,
    name,
    args,
    context,
    location,
  );
  if (listened) return listened;
  if (realm.isGlobalAlias(receiver.name) && name === "matchMedia")
    return mediaQueryListValue(args[0]);
  const hotModuleResult = callHotModuleMethod(receiver, name);
  if (hotModuleResult) return hotModuleResult;
  if (isHistoryName(receiver.name))
    return callHistoryMethod(
      interpreter.history,
      interpreter.origin,
      name,
      args,
      location,
      (listener) => interpreter.markEscaped(listener),
    );
  if (isIndexedDbName(receiver.name))
    return callIndexedDbMethod(
      indexedDbHost(interpreter, context, location),
      interpreter.indexedDb,
      name,
      args,
    );
  if (isWebCryptoName(receiver.name))
    return callWebCryptoMethod(
      receiver.name,
      name,
      args,
      (list) => interpreter.recordHeapMutation(list),
      location,
    );
  const storageAreaName = getStorageAreaName(receiver.name);
  return storageAreaName === null
    ? null
    : callStorageMethod(
        interpreter.storageAreas[storageAreaName],
        storageAreaName,
        name,
        args,
        location,
      );
};

/** `Object(value)`: objects pass through, nullish values become `{}`, primitives box into wrappers. */
const toObjectValue = (value: StaticValue, location: SourceLocation | null): StaticValue =>
  mapValue(value, (alternative) => {
    switch (alternative.kind) {
      case "primitive":
        return alternative.value === null || alternative.value === undefined
          ? objectValue([])
          : nativeObjectValue(Object(alternative.value), null);
      case "unknown-primitive":
      case "symbol":
        return objectValue([
          { kind: "spread", value: unknownValue(`boxed ${describeValue(alternative)}`, location) },
        ]);
      default:
        return alternative;
    }
  });

/** Builtins that only inspect their first argument, so a branch there yields a branch of per-alternative results. */
const INSPECTING_GLOBALS = new Set([
  "Array.isArray",
  "ArrayBuffer.isView",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.getOwnPropertyNames",
  "Object.getOwnPropertySymbols",
  "Object.getOwnPropertyDescriptor",
  "Object.getOwnPropertyDescriptors",
  "Object.getPrototypeOf",
  "Object.isFrozen",
  "Reflect.ownKeys",
  "Reflect.getPrototypeOf",
  "Reflect.has",
  "Reflect.get",
  "isNaN",
  "Number.isNaN",
  "Number.isFinite",
  "Number.isInteger",
  "Number.isSafeInteger",
  "JSON.stringify",
]);

const callGlobal = (
  interpreter: Interpreter,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor: boolean,
): StaticValue => {
  if (!isConstructor) {
    const invoked = callInvokedGlobal(interpreter, name, args, context, location);
    if (invoked) return invoked;
    const [receiver, memberName] = splitGlobalName(name);
    const hostResult =
      receiver.kind === "global"
        ? callHostObjectMethod(interpreter, receiver, memberName, args, context, location)
        : null;
    if (hostResult) return hostResult;
    const [inspected, ...rest] = args;
    if (inspected?.kind === "branch" && INSPECTING_GLOBALS.has(name)) {
      return mapValue(inspected, (alternative) =>
        callGlobal(interpreter, name, [alternative, ...rest], context, location, false),
      );
    }
  }
  if (isErrorConstructorName(name)) return createErrorValue(name, args, location);
  if (name === "import.meta.glob") return callImportMetaGlob(interpreter, args, context, location);
  if (name === "require.context") return callRequireContext(interpreter, args, context, location);
  if (isStringCodecName(name)) return callStringCodec(name, args, location);
  if (name === "Buffer.from") return createBufferValue(args, location);
  if (name === "Buffer.byteLength") return getBufferByteLength(args);
  const [first, second] = args;
  if (isConstructor && (isTypedArrayName(name) || name === "ArrayBuffer"))
    return constructBinary(name, args, location);
  if (name === "ArrayBuffer.isView") {
    const isView = isBinaryView(first);
    return isView === null
      ? unknownPrimitiveValue("boolean", "ArrayBuffer.isView on dynamic value")
      : primitiveValue(isView);
  }
  if (name.endsWith(".of")) {
    const ofItems = binaryFromItems(name.slice(0, -".of".length), args);
    if (ofItems) return ofItems;
  }
  if (name === "Intl.NumberFormat") return createNumberFormat(args, location);
  if (isConstructor && name === "TextEncoder") return createTextEncoder();
  if (isConstructor && name === "TextDecoder") return createTextDecoder(first, location);
  if (isConstructor && isDomObserverName(name))
    return createDomObserver(interpreter, name, first, location);
  if (isConstructor && isNativeConstructorName(name) && (name !== "Date" || args.length > 0)) {
    const constructed = constructNativeObject(name, args);
    if (constructed) return constructed;
  }
  if (isConstructor && isHostNodeConstructorName(name) && interpreter.hostDocument) {
    const node = constructHostNode(interpreter.hostDocument, name, args);
    if (node) return node;
  }
  switch (name) {
    case "Date": {
      if (!isConstructor) break;
      if (args.length === 0) return createClockDateValue(interpreter.timers.readClock("new Date"));
      if (args.length === 1 && first !== undefined && isClockReading(first))
        return createClockDateValue(first);
      break;
    }
    case "Function":
      return constructFunctionFromSource(interpreter, args, location);
    case "Object":
      return first ? toObjectValue(first, location) : objectValue([]);
    case "String":
      return first ? toStringOfValue(first) : primitiveValue("");
    case "Number":
      return first ? toNumberValue(first) : primitiveValue(0);
    case "Boolean":
      return first ? toBooleanValue(first) : FALSE_VALUE;
    case "Array":
      return args.length === 1 && first !== undefined
        ? arrayOfLength(first, location)
        : listValue(args);
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return createCollectionValue(
        name,
        first && interpreter.resolveIterable(first, context, location),
        location,
      );
    case "URLSearchParams":
      return mapValue(distributeObjectBranches(first ?? UNDEFINED_VALUE), (init) =>
        createSearchParamsValue(init, { location }),
      );
    case "URL":
      return createUrlValue(args, location);
    case "AbortController":
      if (isConstructor) return createAbortController(interpreter, location);
      break;
    case "Image":
      if (isConstructor)
        return createImageElement(imageLoadHost(interpreter, context, location), args);
      break;
    case "fetch":
      if (isConstructor) break;
      return callFetch(interpreter.project, args, location);
    case "Blob":
      if (isConstructor) return createBlobValue(args, location);
      break;
    case "RegExp": {
      if (second !== undefined && second.kind !== "primitive")
        return unknownValue("RegExp with dynamic flags", location);
      const flags = second?.value === undefined ? null : String(second.value);
      return mapValue(first ?? UNDEFINED_VALUE, (pattern) =>
        pattern.kind === "regexp"
          ? { ...pattern, flags: flags ?? pattern.flags, lastIndex: 0 }
          : pattern.kind === "primitive" && pattern.value !== undefined
            ? { kind: "regexp", pattern: String(pattern.value), flags: flags ?? "", lastIndex: 0 }
            : unknownValue("RegExp from a dynamic pattern", location),
      );
    }
    case "Proxy":
      return isConstructor && first && second?.kind === "object"
        ? { kind: "proxy", target: first, handler: second }
        : unknownValue("Proxy without a static handler", location);
    case "Promise":
      return createPromiseValue(first, promiseTools(interpreter, context, location), location);
    case "Symbol":
      if (isConstructor) break;
      if (!first || (first.kind === "primitive" && first.value === undefined))
        return createSymbolValue(undefined);
      return first.kind === "primitive"
        ? createSymbolValue(String(first.value))
        : unknownValue("Symbol with a dynamic description", location);
    case "Symbol.for":
      return first?.kind === "primitive" && typeof first.value === "string"
        ? createRegisteredSymbolValue(first.value)
        : unknownValue("Symbol.for with a dynamic key", location);
    case "Promise.resolve":
      return resolvedPromiseValue(first ?? UNDEFINED_VALUE);
    case "Promise.reject":
      return resolvedPromiseValue(
        thrownValue("rejected promise", first ?? UNDEFINED_VALUE, location),
      );
    case "Promise.all":
      return first?.kind === "list"
        ? combinePromises(first.items, promiseTools(interpreter, context, location), location)
        : unknownValue("Promise.all", location);
    case "Array.isArray": {
      const verdict = first ? isArrayValue(first) : false;
      return verdict === null
        ? unknownPrimitiveValue("boolean", "Array.isArray on dynamic value")
        : primitiveValue(verdict);
    }
    case "Array.from": {
      return mapValue(first ?? UNDEFINED_VALUE, (candidate) => {
        const source = iterableOrArrayLike(interpreter, candidate, context, location);
        if (!source || (source.kind === "primitive" && typeof source.value !== "string")) {
          return unknownValue("Array.from of a non-iterable", location);
        }
        return mapValue(source, (iterable) => {
          const items =
            iterable.kind === "list" || iterable.kind === "repeat"
              ? iterable
              : listValue(spreadListItems(iterable, location));
          return isCallable(second)
            ? mapList(interpreter, items, second, context, location)
            : items;
        });
      });
    }
    case "Int8Array.from":
    case "Uint8Array.from":
    case "Uint8ClampedArray.from":
    case "Int16Array.from":
    case "Uint16Array.from":
    case "Int32Array.from":
    case "Uint32Array.from":
    case "Float32Array.from":
    case "Float64Array.from": {
      const source = first && iterableOrArrayLike(interpreter, first, context, location);
      if (source?.kind !== "list") return unknownValue(`${name} of dynamic iterable`, location);
      const mapped = isCallable(second)
        ? mapList(interpreter, source, second, context, location)
        : source;
      return mapped.kind === "list"
        ? (binaryFromItems(name.slice(0, -".from".length), mapped.items) ?? mapped)
        : mapped;
    }
    case "Object.hasOwn":
      return mapValue(first ?? UNDEFINED_VALUE, (target) => {
        if (target.kind === "primitive") {
          if (target.value === null || target.value === undefined) {
            return thrownValue(
              "Object.hasOwn on a nullish target",
              createErrorValue(
                "TypeError",
                [primitiveValue("Cannot convert undefined or null to object")],
                location,
              ),
              location,
            );
          }
          const key = toPropertyKey(second ?? UNDEFINED_VALUE);
          if (key !== null) return primitiveValue(Object.hasOwn(Object(target.value), key));
        }
        return (
          hasOwnProperty(target, second ?? UNDEFINED_VALUE, "hasOwnProperty") ??
          unknownPrimitiveValue("boolean", "Object.hasOwn of a partially known target")
        );
      });
    case "Object.keys":
    case "Object.values":
    case "Object.entries": {
      const inspect = (target: StaticValue): StaticValue => {
        const ownEntries = getOwnEnumerableEntries(target);
        if (!ownEntries) return unknownValue(`${name} of ${describeValue(target)}`, location);
        if (name === "Object.keys")
          return listValue(ownEntries.map(([key]) => primitiveValue(key)));
        if (name === "Object.values") return listValue(ownEntries.map(([, value]) => value));
        return listValue(ownEntries.map(([key, value]) => listValue([primitiveValue(key), value])));
      };
      const target = interpreter.materializeNamespace(
        first ?? UNDEFINED_VALUE,
        context.environment,
      );
      return getOwnEnumerableEntries(target)
        ? inspect(target)
        : mapValue(distributeObjectBranches(target), inspect);
    }
    case "Object.assign":
      if (
        first?.kind === "function" ||
        first?.kind === "class" ||
        first?.kind === "component-reference"
      ) {
        let target: StaticValue = first;
        for (const source of args.slice(1)) {
          if (source.kind !== "object") continue;
          for (const key of getKnownObjectKeys(source) ?? []) {
            target = interpreter.assignProperty(
              target,
              key,
              getObjectProperty(source, key),
              context,
            );
          }
        }
        return target;
      }
      if (first?.kind === "object") {
        interpreter.recordHeapMutation(first);
        for (const source of args.slice(1)) assignOwnEntries(first, source);
        return first;
      }
      if (first && first.kind !== "unknown" && first.kind !== "branch") return first;
      return objectValue(args.map((argument) => ({ kind: "spread", value: argument })));
    case "Object.freeze":
      if (first?.kind === "object" || first?.kind === "list") first.isFrozen = true;
      return first ?? UNDEFINED_VALUE;
    case "Object.is": {
      const left = first ?? UNDEFINED_VALUE;
      const right = second ?? UNDEFINED_VALUE;
      if (left.kind === "primitive" && right.kind === "primitive")
        return primitiveValue(Object.is(left.value, right.value));
      const isSame = compareIdentity(left, right);
      return isSame === null
        ? unknownPrimitiveValue("boolean", "Object.is on dynamic values")
        : primitiveValue(isSame);
    }
    case "Object.isFrozen":
      if (first?.kind === "object" || first?.kind === "list")
        return primitiveValue(first.isFrozen === true);
      if (first?.kind === "primitive") return TRUE_VALUE;
      return unknownPrimitiveValue("boolean", `${name} on a dynamic target`);
    case "Object.seal":
    case "Object.setPrototypeOf":
      return first ?? UNDEFINED_VALUE;
    case "Object.getPrototypeOf":
    case "Reflect.getPrototypeOf":
      if (first?.kind === "class") return getClassPrototype(first);
      if (first?.kind === "function") return { kind: "global", name: "Function.prototype" };
      if (first?.kind === "object" && first.prototype) return first.prototype;
      if (first?.kind === "object" && first.hasNullPrototype) return NULL_VALUE;
      if (first?.kind === "object" && first.constructedBy)
        return getClassPrototypeObject(interpreter, first.constructedBy, context);
      if (first?.kind === "object" && (isBaseClassPrototype(first) || !isClassPrototype(first)))
        return { kind: "global", name: "Object.prototype" };
      return getWitnessedPrototype(first, name, location);
    case "Object.getOwnPropertyNames":
    case "Object.getOwnPropertySymbols":
    case "Reflect.ownKeys": {
      if (first?.kind === "function") {
        const names = name === "Object.getOwnPropertySymbols" ? [] : getFunctionOwnNames(first);
        return names
          ? listValue(names.map((key) => primitiveValue(key)))
          : unknownValue(`${name} on a partially known function`, location);
      }
      if (first?.kind !== "object" && first?.kind !== "list")
        return unknownValue(`${name} on a dynamic target`, location);
      const ownNames = name === "Object.getOwnPropertySymbols" ? [] : getOwnNames(first);
      const ownSymbols =
        name === "Object.getOwnPropertyNames" || first.kind === "list"
          ? []
          : getKnownObjectSymbols(first);
      return ownNames && ownSymbols
        ? listValue([...ownNames.map((key) => primitiveValue(key)), ...ownSymbols])
        : unknownValue(`${name} on an object with dynamic spreads`, location);
    }
    case "Object.getOwnPropertyDescriptor": {
      const key = second ? toPropertyKey(second) : null;
      if (first?.kind === "element" && key === "ref")
        return getElementRefDescriptor(first, location);
      if (first?.kind === "function" && key !== null)
        return getFunctionOwnPropertyDescriptor(interpreter, first, key, context, location);
      if (first?.kind !== "object" || key === null)
        return unknownValue(`${name} on a dynamic target`, location);
      return (
        getOwnPropertyDescriptor(first, key) ??
        unknownValue(`${name} on an object with dynamic spreads`, location)
      );
    }
    case "Object.create": {
      if (!first) break;
      return mapValue(first, (prototype) => {
        const isNull = prototype.kind === "primitive" && prototype.value === null;
        const isIntrinsicPrototype =
          prototype.kind === "global" && INTRINSIC_PROTOTYPE_NAMES.has(prototype.name);
        const intrinsicPrototype =
          prototype.kind === "global" && !isIntrinsicPrototype
            ? getIntrinsicPrototypeObject(prototype.name)
            : null;
        if (!isNull && !isIntrinsicPrototype && !intrinsicPrototype && prototype.kind !== "object")
          return unknownValue(`Object.create with ${describeValue(prototype)}`, location);
        const created: StaticObjectValue =
          prototype.kind === "object"
            ? { ...objectValue(), prototype }
            : intrinsicPrototype
              ? { ...objectValue(), prototype: intrinsicPrototype }
              : { ...objectValue(), hasNullPrototype: isNull };
        if (second?.kind === "object") {
          defineOwnProperties(interpreter, created, second, context, location);
        }
        return created;
      });
    }
    case "Reflect.get":
      return first && second?.kind === "primitive"
        ? interpreter.getProperty(first, String(second.value), context, location)
        : unknownValue("Reflect.get with a dynamic key", location);
    case "Reflect.has":
      return (
        (first && second && hasProperty(second, first)) ??
        unknownValue("Reflect.has on a dynamic target", location)
      );
    case "Reflect.apply": {
      const applied = args[2];
      if (!first || !applied) return unknownValue("Reflect.apply without arguments", location);
      const appliedArguments =
        applied.kind === "list" && applied.items.every((item) => item.kind !== "repeat")
          ? applied.items
          : null;
      return appliedArguments
        ? interpreter.callValue(first, appliedArguments, context, location, {
            thisValue: second ?? null,
          })
        : unknownValue("Reflect.apply with dynamic arguments", location);
    }
    case "Reflect.construct": {
      const newTarget = args[2];
      if (!first) return unknownValue("Reflect.construct without a target", location);
      const constructArguments =
        second === undefined ? [] : isKnownList(second) ? second.items : null;
      if (constructArguments === null) {
        return unknownValue("Reflect.construct with dynamic arguments", location);
      }
      const superConstructed =
        context.thisValue &&
        interpreter.constructSuper(context.thisValue, first, constructArguments);
      if (superConstructed) return superConstructed;
      if (newTarget && newTarget !== first) {
        return unknownValue("Reflect.construct with a foreign new.target", location);
      }
      return interpreter.construct(first, constructArguments, context, location);
    }
    case "Object.defineProperty": {
      const descriptor = args[2];
      const key = second ? getPropertyName(second) : null;
      if (!first || key === null || descriptor?.kind !== "object") {
        return first ?? unknownValue("Object.defineProperty on a dynamic target", location);
      }
      defineOwnProperty(interpreter, first, key, descriptor, context, location);
      return first;
    }
    case "Object.getOwnPropertyDescriptors":
      return first
        ? getOwnPropertyDescriptors(interpreter, first, context, location)
        : unknownValue(`${name} without a target`, location);
    case "Object.defineProperties": {
      if (!first || second?.kind !== "object") {
        return first ?? unknownValue("Object.defineProperties on a dynamic target", location);
      }
      defineOwnProperties(interpreter, first, second, context, location);
      return first;
    }
    case "Object.fromEntries": {
      const entries = first && interpreter.resolveIterable(first, context, location);
      if (entries?.kind === "list" && !entries.items.some((item) => item.kind === "repeat")) {
        return objectValue(
          entries.items.map(
            (pair) =>
              getEntryFromPair(pair) ?? { kind: "spread", value: unknownValue("dynamic entry") },
          ),
        );
      }
      return unknownValue("Object.fromEntries of dynamic entries", location);
    }
    case "Object.groupBy":
    case "Map.groupBy":
      return first && isCallable(second)
        ? groupItems(interpreter, name, first, second, context, location)
        : unknownValue(`${name} without a callback`, location);
    case "parseInt":
    case "Number.parseInt":
      if (
        first?.kind === "primitive" &&
        typeof first.value !== "symbol" &&
        (second === undefined || second.kind === "primitive")
      ) {
        return primitiveValue(Number.parseInt(String(first.value), Number(second?.value)));
      }
      return unknownPrimitiveValue("number", name);
    case "parseFloat":
    case "Number.parseFloat":
      if (first?.kind === "primitive" && typeof first.value !== "symbol")
        return primitiveValue(Number.parseFloat(String(first.value)));
      return unknownPrimitiveValue("number", name);
    case "isNaN":
    case "isFinite": {
      const number = first === undefined ? primitiveValue(Number.NaN) : toNumberValue(first);
      if (number.kind === "primitive" && typeof number.value === "number") {
        return primitiveValue(
          name === "isNaN" ? Number.isNaN(number.value) : Number.isFinite(number.value),
        );
      }
      return unknownPrimitiveValue("boolean", name);
    }
    case "Number.isNaN":
    case "Number.isFinite":
    case "Number.isInteger":
    case "Number.isSafeInteger": {
      if (first === undefined) return FALSE_VALUE;
      if (first.kind === "primitive") return primitiveValue(NUMBER_PREDICATES[name](first.value));
      const typeofFirst = getTypeofValue(first, interpreter.getRealm(context.environment));
      if (typeofFirst.kind === "primitive" && typeofFirst.value !== "number") return FALSE_VALUE;
      return unknownPrimitiveValue("boolean", name);
    }
    case "JSON.stringify": {
      if (!first || args.length !== 1) return unknownPrimitiveValue("string", "JSON.stringify");
      return mapValue(distributeObjectBranches(first), (alternative) => {
        if (alternative.kind === "unknown-primitive" && alternative.primitiveType === "string") {
          return quoteUnknownString(alternative);
        }
        const json = toJsonValue(alternative);
        return json === undefined
          ? unknownPrimitiveValue("string", "JSON.stringify")
          : primitiveValue(JSON.stringify(json));
      });
    }
    case "JSON.parse": {
      const text = first ?? UNDEFINED_VALUE;
      if (
        text.kind === "primitive" &&
        (second === undefined || (second.kind === "primitive" && second.value === undefined))
      ) {
        try {
          return jsonValue(JSON.parse(String(text.value)));
        } catch (error) {
          return thrownValue(
            "JSON.parse of invalid JSON",
            createErrorValue(
              "SyntaxError",
              [primitiveValue(error instanceof Error ? error.message : String(error))],
              location,
            ),
            location,
          );
        }
      }
      return unknownValue("JSON.parse", location);
    }
    case "structuredClone":
      return (
        (first && args.length === 1 ? structuredCloneValue(first) : null) ??
        unknownValue("structuredClone of a dynamic value", location)
      );
    case "queueMicrotask":
      if (first) {
        const handle = interpreter.timers.createHandle("queueMicrotask");
        interpreter.timers.queueMicrotask(
          scheduledTask(interpreter, first, context, location, handle),
          handle,
        );
      }
      return UNDEFINED_VALUE;
    case "setTimeout":
    case "setImmediate":
    case "requestAnimationFrame":
    case "requestIdleCallback": {
      const handle = interpreter.timers.createHandle(name);
      if (first) {
        const delayMs = interpreter.timers.getSettledDelay(second);
        if (delayMs === null) interpreter.markEscaped(first);
        else {
          interpreter.timers.schedule(
            handle,
            scheduledTask(
              interpreter,
              first,
              context,
              location,
              handle,
              name === "setTimeout" ? args.slice(2) : [],
            ),
            delayMs,
          );
        }
      }
      return handle;
    }
    case "setInterval": {
      const handle = interpreter.timers.createHandle(name);
      if (first) {
        const delayMs = interpreter.timers.getSettledDelay(second);
        const isDeferred = interpreter.timers.isDeferred;
        if (delayMs === null) interpreter.markEscaped(first);
        else {
          interpreter.timers.schedule(
            handle,
            () =>
              interpreter.runIntervalTicks(
                first,
                handle,
                context,
                location,
                isDeferred,
                args.slice(2),
              ),
            delayMs,
          );
        }
      }
      return handle;
    }
    case "clearTimeout":
    case "clearInterval":
    case "cancelAnimationFrame":
    case "cancelIdleCallback":
      if (first?.kind === "branch") {
        return interpreter.callAlternatives(first, context, (alternative, alternativeContext) =>
          callGlobal(
            interpreter,
            name,
            [alternative, ...args.slice(1)],
            alternativeContext,
            location,
            false,
          ),
        );
      }
      interpreter.timers.clear(first);
      return UNDEFINED_VALUE;
    case "Date.now":
    case "performance.now":
      return interpreter.timers.readClock(name);
    case "console.log":
    case "console.warn":
    case "console.error":
    case "console.info":
    case "console.debug":
      return UNDEFINED_VALUE;
    default:
      break;
  }
  if (name === "Math.random")
    return recordInputSource(rangedNumberValue(name, { min: 0, max: 1 }), "random", location);
  if (name === "Intl.getCanonicalLocales") {
    const natives = toNativeArguments(args, null);
    if (natives === null) return unknownValue(`${name}() with dynamic arguments`, location);
    try {
      return fromNativeValue(
        Reflect.apply(Intl.getCanonicalLocales, Intl, natives),
        `${name}()`,
        null,
      );
    } catch (error) {
      return thrownValue(
        `${name}() with an invalid language tag`,
        createErrorValue(
          "RangeError",
          [primitiveValue(error instanceof Error ? error.message : String(error))],
          location,
        ),
        location,
      );
    }
  }
  if (name.startsWith("Math.")) {
    const method = name.slice("Math.".length);
    const mathFunction: unknown = Reflect.get(Math, method);
    const branchIndex = args.findIndex((argument) => argument.kind === "branch");
    const combinations = args.reduce(
      (count, argument) => count * (argument.kind === "branch" ? argument.alternatives.length : 1),
      1,
    );
    if (
      typeof mathFunction === "function" &&
      !isConstructor &&
      branchIndex !== -1 &&
      combinations <= MAX_DISTRIBUTED_ALTERNATIVES &&
      args.every(isNumericMathArgument)
    ) {
      return mapValue(args[branchIndex], (alternative) =>
        callGlobal(
          interpreter,
          name,
          args.with(branchIndex, alternative),
          context,
          location,
          false,
        ),
      );
    }
    const natives = toNativeArguments(args, null);
    if (typeof mathFunction === "function" && natives !== null)
      return fromNativeValue(Reflect.apply(mathFunction, Math, natives), `${name}()`, null);
    return applyMathToRanges(method, args) ?? unknownPrimitiveValue("number", name);
  }
  if (name === "Date.UTC" || name === "Date.parse") {
    const natives = toNativeArguments(args, null);
    if (natives === null)
      return unknownPrimitiveValue("number", `${name}() with dynamic arguments`);
    const dateFunction = name === "Date.UTC" ? Date.UTC : Date.parse;
    return fromNativeValue(Reflect.apply(dateFunction, Date, natives), `${name}()`, null);
  }
  if (isConstructor) return unknownValue(`new ${name}()`, location);
  return unknownValue(`${name}()`, location);
};

/** A task queued from a continuation of unknown timing runs at an unknown time too. */
const scheduledTask = (
  interpreter: Interpreter,
  callback: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
  handle: StaticValue,
  callbackArguments: StaticValue[] = [],
): (() => void) => {
  const task = interpreter.timers.isDeferred
    ? () => interpreter.callDeferred(callback, callbackArguments, context, location)
    : () => interpreter.callValue(callback, callbackArguments, context, location);
  return () => interpreter.runTimerTask(handle, context, location, task);
};

const fallbackMethodResult = (
  receiver: StaticValue,
  name: string,
  location: SourceLocation | null,
): StaticValue => {
  if (name === "split") return dynamicSplitResult(location);
  if (isListPreservingMethod(name) && (receiver.kind === "unknown" || receiver.kind === "repeat")) {
    return receiver;
  }
  return (
    getLanguageMethodResult(receiver, name) ??
    unknownValue(`${describeValue(receiver)}.${name}()`, location)
  );
};

/** Browser events fire in later tasks; from a deferred continuation they stay deferred. */
const scheduleTask = (
  interpreter: Interpreter,
  description: string,
): ((task: () => void) => void) => {
  const isDeferred = interpreter.timers.isDeferred;
  return (task) =>
    interpreter.timers.schedule(
      interpreter.timers.createHandle(description),
      isDeferred ? () => interpreter.timers.runDeferred(task) : task,
    );
};

const indexedDbHost = (
  interpreter: Interpreter,
  context: EvaluationContext,
  location: SourceLocation | null,
): IndexedDbHost => ({
  schedule: scheduleTask(interpreter, "IndexedDB request"),
  call: (callee, callArgs) => interpreter.callValue(callee, callArgs, context, location),
  setProperty: (object, key, value) => interpreter.assignOwnProperty(object, key, value),
  location,
});

const imageLoadHost = (
  interpreter: Interpreter,
  context: EvaluationContext,
  location: SourceLocation | null,
): ImageLoadHost => ({
  schedule: scheduleTask(interpreter, "image load"),
  queueMicrotask: (task) => interpreter.timers.queueMicrotask(task),
  call: (callee, callArgs) => interpreter.callValue(callee, callArgs, context, location),
  setProperty: (object, key, value, accessor) =>
    interpreter.assignOwnProperty(object, key, value, accessor),
  markEscaped: (value) => interpreter.markEscaped(value),
  readServedAsset: (url) => interpreter.project.readServedAsset(url),
});

export const promiseTools = (
  interpreter: Interpreter,
  context: EvaluationContext,
  location: SourceLocation | null,
): PromiseTools => ({
  call: (callee, callArgs) => interpreter.callValue(callee, callArgs, context, location),
  callDeferred: (callee, callArgs) => interpreter.callDeferred(callee, callArgs, context, location),
  markEscaped: (value) => interpreter.markEscaped(value),
  queueMicrotask: (task) => interpreter.queueMicrotask(task, context, location),
  bindTask: (task) => interpreter.bindTask(task, context, location),
  runTask: (cause, task) => interpreter.runTaskWithCause(cause, task, context, location),
  recordStateMutation: (state) => interpreter.recordStateMutation(state),
});

/**
 * `then`/`catch`/`finally`. Handlers on a modeled promise run as microtasks
 * once it settles; on a value the analysis cannot follow they are
 * continuations that land after the captured commit; any other receiver is
 * treated as an already-fulfilled thenable.
 */
const callPromiseMethod = (
  interpreter: Interpreter,
  receiver: StaticValue,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const [first, second] = args;
  const handlers: PromiseHandlers = {
    onFulfilled: name === "then" && isCallable(first) ? first : null,
    onRejected:
      name === "catch" ? (isCallable(first) ? first : null) : isCallable(second) ? second : null,
    onFinally: name === "finally" && isCallable(first) ? first : null,
  };
  const modeled = getModeledPromise(receiver);
  if (modeled) {
    return chainPromise(modeled, handlers, promiseTools(interpreter, context, location), location);
  }
  if (receiver.kind === "unknown" || receiver.kind === "external") {
    if (handlers.onFulfilled)
      return interpreter.callDeferred(handlers.onFulfilled, [receiver], context, location);
    for (const handler of [handlers.onRejected, handlers.onFinally]) {
      if (handler) interpreter.markEscaped(handler);
    }
    return receiver;
  }
  if (handlers.onFulfilled)
    return interpreter.callValue(handlers.onFulfilled, [receiver], context, location);
  if (handlers.onFinally) {
    const result = interpreter.callValue(handlers.onFinally, [], context, location);
    if (isThrownOutcome(result)) return result;
  }
  return receiver;
};

const isNumericMathArgument = (value: StaticValue): boolean => {
  if (value.kind === "branch")
    return value.alternatives.every(
      (alternative) => alternative.kind === "primitive" && typeof alternative.value === "number",
    );
  return value.kind === "primitive"
    ? typeof value.value === "number"
    : value.kind === "unknown-primitive" && value.primitiveType === "number";
};

export const evaluateBuiltinCall = (
  interpreter: Interpreter,
  callee: Extract<StaticValue, { kind: "method" | "global" }>,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor = false,
): StaticValue => {
  if (callee.kind === "global")
    return callGlobal(interpreter, callee.name, args, context, location, isConstructor);
  const { receiver, name } = callee;
  const boundArguments = bindCallbackThisArg(name, args);
  const [first, second] = boundArguments;

  if (isPromiseMethodName(name))
    return callPromiseMethod(interpreter, receiver, name, args, context, location);

  if (name === "toString" && args.length === 0) {
    const sourceText = getFunctionText(receiver);
    if (sourceText !== null) return sourceText;
  }

  if ((name === "hasOwnProperty" || name === "propertyIsEnumerable") && first !== undefined) {
    const ownProperty = hasOwnProperty(receiver, first, name);
    if (ownProperty) return ownProperty;
  }

  if (receiver.kind === "function") {
    if (name === "bind") {
      return {
        ...receiver,
        name: `bound ${receiver.name ?? ""}`,
        properties: objectValue(),
        hasPrototype: false,
        boundThis: receiver.boundThis ?? first ?? UNDEFINED_VALUE,
        boundArgs: [...(receiver.boundArgs ?? []), ...args.slice(1)],
      };
    }
    if (name === "call")
      return interpreter.callFunction(receiver, args.slice(1), context, {
        thisValue: first ?? null,
      });
    if (name === "apply") {
      return interpreter.callFunction(
        receiver,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        { thisValue: first ?? null },
      );
    }
    return unknownValue(`function.${name}()`, location);
  }

  if (name === "isPrototypeOf" && first !== undefined) {
    const isOnChain = isPrototypeOf(receiver, first);
    if (isOnChain !== null) return primitiveValue(isOnChain);
  }

  if (receiver.kind === "global")
    return callGlobal(interpreter, `${receiver.name}.${name}`, args, context, location, false);

  const listened = callEventTargetMethod(
    interpreter,
    interpreter.getRealm(context.environment),
    receiver,
    name,
    args,
    context,
    location,
  );
  if (listened) return listened;

  if (name === "bind" && receiver.kind === "class" && args.length <= 1) return receiver;

  if (
    (name === "call" || name === "apply") &&
    (receiver.kind === "class" ||
      (receiver.kind === "react-api" &&
        (receiver.api === "Component" || receiver.api === "PureComponent")))
  ) {
    return UNDEFINED_VALUE;
  }

  if (
    receiver.kind === "react-api" ||
    receiver.kind === "native-function" ||
    receiver.kind === "method"
  ) {
    const rebound: StaticValue =
      receiver.kind === "method" && first !== undefined
        ? { kind: "method", receiver: first, name: receiver.name }
        : receiver;
    if (name === "call") return interpreter.callValue(rebound, args.slice(1), context, location);
    if (name === "apply") {
      return interpreter.callValue(
        rebound,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        location,
      );
    }
    if (name === "bind") {
      if (rebound.kind !== "method") return rebound;
      const boundArgs = args.slice(1);
      return nativeFunction(`bound ${rebound.name}`, (callArgs, tools) =>
        tools.call(rebound, [...boundArgs, ...callArgs]),
      );
    }
  }

  if (receiver.kind === "primitive") {
    const branchIndex = args.findIndex(isPrimitiveBranch);
    if (branchIndex !== -1 && args.filter((argument) => argument.kind === "branch").length === 1) {
      return mapValue(args[branchIndex], (alternative) =>
        evaluateBuiltinCall(
          interpreter,
          callee,
          args.with(branchIndex, alternative),
          context,
          location,
          isConstructor,
        ),
      );
    }
    const computed =
      typeof receiver.value === "string"
        ? callStringMethod(interpreter, receiver.value, name, args, context)
        : typeof receiver.value === "number" ||
            typeof receiver.value === "boolean" ||
            typeof receiver.value === "bigint"
          ? callNumberMethod(receiver.value, name, args)
          : null;
    if (computed) return computed;
  }

  if (receiver.kind === "regexp") return callRegExpMethod(receiver, name, args, location);

  if (receiver.kind === "unknown-primitive") {
    const shaped = callShapedPrimitiveMethod(receiver, name, args);
    if (shaped) return shaped;
    const declared = getLanguageMethodResult(receiver, name);
    if (declared) {
      return (
        memoizeScalarOperation(
          `${receiver.primitiveType}.${name}`,
          [receiver, ...args],
          () => declared,
        ) ?? declared
      );
    }
  }

  const arrayResult = callArrayMethod(
    interpreter,
    receiver,
    name,
    args,
    context,
    location,
    boundArguments,
  );
  if (arrayResult) return arrayResult;

  return fallbackMethodResult(receiver, name, location);
};
