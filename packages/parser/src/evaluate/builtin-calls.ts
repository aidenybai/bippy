import type {
  SourceLocation,
  StaticAccessor,
  StaticElementType,
  StaticElementValue,
  StaticFunctionValue,
  StaticGlobalValue,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticRegExpValue,
  StaticValue,
} from "../types.js";
import { getReactApiTypeof } from "../react/react-api.js";
import {
  ForwardRefTag,
  FunctionComponentTag,
  LazyComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
} from "../work-tags.js";
import type { HostDocument } from "../host/host-document.js";
import type { HostRealm } from "../host/host-realm.js";
import {
  type EnvironmentLookup,
  BUNDLER_INJECTED_NAMES,
  callHotModuleMethod,
  getBundlerGlobal,
  getBundlerGlobalTypeof,
} from "./bundler-globals.js";
import {
  GLOBAL_OBJECT_VALUE,
  getHostGlobal,
  getHostGlobalTypeof,
  getLanguageMethodResult,
} from "./host-globals.js";
import { createAbortController } from "./abort-controller.js";
import { createDomObserver, isDomObserverName } from "./dom-observers.js";
import { createErrorValue, isErrorConstructorName } from "./errors.js";
import { nativeFunction } from "../frameworks/stubs.js";
import {
  constructNativeObject,
  fromNativeValue,
  isNativeConstructorName,
  toNativeArguments,
} from "./native-values.js";
import { constructFunctionFromSource } from "./function-constructor.js";
import { callImportMetaGlob } from "./import-glob.js";
import { callEventTargetMethod } from "./event-listeners.js";
import { hasProperty, isIntrinsicFunctionKey } from "./has-property.js";
import {
  getBuiltinFunctionSource,
  getBuiltinPrototype,
  getBuiltinPrototypeName,
  getPrototypeWitness,
  isPrototypeOf,
  isTypedArrayName,
} from "./instance-of.js";
import { mediaQueryListValue } from "./media-query.js";
import { getObjectTag } from "./object-tag.js";
import { callHistoryMethod, isHistoryName } from "./session-history.js";
import { callStorageMethod, getStorageAreaName } from "./web-storage.js";
import type { EvaluationContext } from "./context.js";
import { createCollectionValue, getCollectionItems } from "./collections.js";
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
import { callShapedPrimitiveMethod, rangedNumberValue } from "./primitive-shapes.js";
import { createSearchParamsValue } from "./url-search-params.js";
import {
  callStringCodec,
  createBufferValue,
  getBufferByteLength,
  isStringCodecName,
} from "./text-encoding.js";
import { createUrlValue } from "./url.js";
import { getClassPrototypeObject, isBaseClassPrototype } from "./class-component.js";
import type { Interpreter } from "./interpreter.js";
import {
  accessorEntry,
  branchValue,
  createSymbolValue,
  describeValue,
  FALSE_VALUE,
  getClassPrototype,
  getKnownObjectKeys,
  getOwnPropertyDescriptor,
  getKnownObjectSymbols,
  getListLength,
  getObjectProperty,
  getPropertyName,
  getSymbolPropertyKey,
  getTruthiness,
  compareIdentity,
  isSymbolPropertyKey,
  hasDefiniteItems,
  isIndefiniteItem,
  isKnownList,
  jsonValue,
  listValue,
  isNullish,
  mapValue,
  toBooleanValue,
  toJsonValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  optionalValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  spreadListItems,
  thrownValue,
  unknownValue,
} from "./values.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);

const NUMBER_PREDICATES: Record<string, (value: StaticPrimitive) => boolean> = {
  "Number.isNaN": Number.isNaN,
  "Number.isFinite": Number.isFinite,
  "Number.isInteger": Number.isInteger,
  "Number.isSafeInteger": Number.isSafeInteger,
};

export const isPromiseMethodName = (name: string): boolean => PROMISE_METHOD_NAMES.has(name);

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

const ITERATION_METHOD_NAMES = new Set(["map", "forEach", "flatMap", "filter"]);

const THIS_ARG_METHOD_NAMES = new Set([
  ...ITERATION_METHOD_NAMES,
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
]);

/** `list.forEach(callback, thisArg)`: the callback runs with `this` set to `thisArg` (arrows keep their lexical `this`). */
const bindCallbackThisArg = (name: string, args: StaticValue[]): StaticValue[] => {
  const [callback, thisArg] = args;
  if (
    thisArg === undefined ||
    !THIS_ARG_METHOD_NAMES.has(name) ||
    callback?.kind !== "function" ||
    callback.boundThis
  )
    return args;
  return [{ ...callback, boundThis: thisArg }];
};

/** `flatMap`/`concat` flattening: arrays contribute their items, anything else itself. */
const flattenOneLevel = (value: StaticValue, location: SourceLocation | null): StaticValue[] =>
  spreadListItems(
    mapValue(value, (alternative) =>
      alternative.kind === "list" || alternative.kind === "unknown"
        ? alternative
        : listValue([alternative]),
    ),
    location,
  );

/** Methods whose callbacks run synchronously (or on promise settlement) even when the receiver is opaque. */
export const isModeledOpaqueMethodName = (name: string): boolean =>
  PROMISE_METHOD_NAMES.has(name) || ITERATION_METHOD_NAMES.has(name);

/** Methods whose result is a list with the items' shape preserved, so an indefinite receiver stands for its own result. */
const LIST_PRESERVING_METHODS = new Set([
  "filter",
  "slice",
  "sort",
  "toSorted",
  "reverse",
  "toReversed",
  "concat",
  "flat",
  "values",
  "toArray",
]);

/** `typeof <global>` in the rendering host; null when its declarations leave it open, or when only the bundler could provide it. */
export const getGlobalTypeof = (name: string, realm: HostRealm): string | null => {
  if (BUNDLER_INJECTED_NAMES.has(name) && !realm.hasGlobal(name)) return null;
  return getBundlerGlobalTypeof(name) ?? getHostGlobalTypeof(realm, name);
};

const getComponentTypeof = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "function":
    case "class":
      return "function";
    case "memo":
    case "forward-ref":
    case "lazy":
    case "context-provider":
    case "context-consumer":
      return "object";
    case "host":
      return "string";
    case "fragment":
    case "strict-mode":
    case "profiler":
    case "suspense":
    case "suspense-list":
    case "activity":
    case "view-transition":
      return "symbol";
    case "stub":
      switch (type.stub.tag ?? FunctionComponentTag) {
        case ForwardRefTag:
        case MemoComponentTag:
        case SimpleMemoComponentTag:
        case LazyComponentTag:
          return "object";
        default:
          return "function";
      }
    default:
      return null;
  }
};

export const getTypeofValue = (value: StaticValue, realm: HostRealm): StaticValue => {
  switch (value.kind) {
    case "branch":
      return mapValue(value, (alternative) => getTypeofValue(alternative, realm));
    case "primitive":
      return primitiveValue(typeof value.value);
    case "function":
    case "class":
    case "native-function":
    case "method":
      return primitiveValue("function");
    case "react-api":
      return primitiveValue(getReactApiTypeof(value.api));
    case "component-reference": {
      const componentTypeof = getComponentTypeof(value.type);
      return componentTypeof
        ? primitiveValue(componentTypeof)
        : unknownPrimitiveValue("string", `typeof ${describeValue(value)}`);
    }
    case "proxy":
      return getTypeofValue(value.target, realm);
    case "native-object":
      return primitiveValue("object");
    case "symbol":
      return primitiveValue("symbol");
    case "object":
    case "list":
    case "element":
    case "namespace":
    case "context":
      return primitiveValue("object");
    case "external":
      return (value.importedName === "*" && value.origin === "binding") ||
        value.origin === "instance"
        ? primitiveValue("object")
        : unknownPrimitiveValue("string", `typeof ${describeValue(value)}`);
    case "global": {
      const globalType = getGlobalTypeof(value.name, realm);
      return globalType
        ? primitiveValue(globalType)
        : unknownPrimitiveValue("string", `typeof ${describeValue(value)}`);
    }
    default:
      return unknownPrimitiveValue("string", `typeof ${describeValue(value)}`);
  }
};

/** A global the bundler injects or the host declares; null when the name is undeclared in this host. */
export const getBuiltinGlobal = (
  name: string,
  realm: HostRealm,
  hostDocument: HostDocument | null,
  environment?: EnvironmentLookup,
): StaticValue | null =>
  getBundlerGlobal(name, environment) ?? getHostGlobal(realm, hostDocument, name);

const toStringValue = (value: StaticValue): StaticValue => {
  if (value.kind === "primitive") return primitiveValue(String(value.value));
  return unknownPrimitiveValue("string", `String(${describeValue(value)})`);
};

const toNumberValue = (value: StaticValue): StaticValue => {
  if (value.kind === "primitive" && typeof value.value !== "bigint")
    return primitiveValue(Number(value.value));
  return unknownPrimitiveValue("number", `Number(${describeValue(value)})`);
};

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

/** `Object.defineProperty`; a function's `name` is what fibers display. */
const defineOwnProperty = (
  interpreter: Interpreter,
  target: StaticValue,
  key: string,
  descriptor: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): void => {
  if (target.kind === "object") {
    const accessor = getDescriptorAccessor(descriptor);
    target.entries.push(
      accessor
        ? accessorEntry(key, accessor, location)
        : {
            kind: "property",
            key,
            value: readDescriptorValue(interpreter, target, descriptor, key, context, location),
          },
    );
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
      target.properties.set(key, value);
      return;
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

const INTRINSIC_PROTOTYPE_NAMES = new Set(["Object.prototype", "Function.prototype"]);

/** `Object.getOwnPropertyNames(fn)`: the intrinsic names, then the names the analyzed code assigned. */
const getFunctionOwnNames = (callable: StaticFunctionValue): string[] => {
  const names = ["length", "name"];
  if (isIntrinsicFunctionKey(callable, "prototype")) names.push("prototype");
  for (const key of callable.properties.keys()) {
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
  if (!getFunctionOwnNames(callable).includes(key)) return UNDEFINED_VALUE;
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
    return objectValue(
      getFunctionOwnNames(target).map((key) => ({
        kind: "property",
        key,
        value: getFunctionOwnPropertyDescriptor(interpreter, target, key, context, location),
      })),
    );
  }
  const ownKeys = target.kind === "object" ? getKnownObjectKeys(target) : null;
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
): [key: string, value: StaticValue][] | null => {
  if (target.kind === "object") {
    return getKnownObjectKeys(target)?.map((key) => [key, getObjectProperty(target, key)]) ?? null;
  }
  if (!hasDefiniteItems(target)) return null;
  return [
    ...target.items.map((item, index): [string, StaticValue] => [String(index), item]),
    ...(target.properties ?? []),
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
  const propertyName = getPropertyName(key);
  if (propertyName === null) return null;
  if (receiver.kind === "object" || receiver.kind === "list") {
    if (receiver.kind === "list" && propertyName === "length")
      return primitiveValue(name === "hasOwnProperty");
    const ownKeys =
      receiver.kind === "object" && isSymbolPropertyKey(propertyName)
        ? getKnownObjectSymbols(receiver)?.map(getSymbolPropertyKey)
        : getOwnEnumerableEntries(receiver)?.map(([ownKey]) => ownKey);
    return ownKeys
      ? primitiveValue(ownKeys.includes(propertyName))
      : unknownPrimitiveValue("boolean", `${name} of a partially known target`);
  }
  if (receiver.kind === "function" || receiver.kind === "class") {
    if (receiver.properties.has(propertyName)) {
      const isClassMember =
        receiver.kind === "class" &&
        receiver.body.members.some(
          (member) => member.isStatic && member.kind !== "field" && member.key === propertyName,
        );
      return primitiveValue(name === "hasOwnProperty" || !isClassMember);
    }
    return primitiveValue(
      name === "hasOwnProperty" && isIntrinsicFunctionKey(receiver, propertyName),
    );
  }
  if (receiver.kind === "global") {
    const builtinPrototype = getBuiltinPrototype(receiver.name);
    if (!builtinPrototype || isSymbolPropertyKey(propertyName)) return null;
    return primitiveValue(
      name === "hasOwnProperty"
        ? Object.hasOwn(builtinPrototype, propertyName)
        : Object.prototype.propertyIsEnumerable.call(builtinPrototype, propertyName),
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

/** `Function.prototype.toString`: the source text of program functions, V8's `[native code]` form for intrinsics. */
const getFunctionSourceText = (receiver: StaticValue): string | null => {
  switch (receiver.kind) {
    case "function":
      return receiver.boundArgs || receiver.boundThis
        ? "function () { [native code] }"
        : receiver.module.file.sourceText.slice(receiver.node.start, receiver.node.end);
    case "class":
      return receiver.module.file.sourceText.slice(receiver.node.start, receiver.node.end);
    case "method":
      return receiver.receiver.kind === "global"
        ? getBuiltinFunctionSource(`${receiver.receiver.name}.${receiver.name}`)
        : receiver.receiver.kind === "external" || receiver.receiver.kind === "unknown"
          ? null
          : `function ${receiver.name}() { [native code] }`;
    case "global":
      return getBuiltinFunctionSource(receiver.name);
    default:
      return null;
  }
};

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
    return callee.kind === "global" && args.length <= 1
      ? callee
      : unknownValue(`${name}()`, location);
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
  const listened = callEventTargetMethod(interpreter, realm, receiver, name, args);
  if (listened) return listened;
  if (realm.isGlobalAlias(receiver.name) && name === "matchMedia")
    return mediaQueryListValue(args[0]);
  const hotModuleResult = callHotModuleMethod(receiver, name);
  if (hotModuleResult) return hotModuleResult;
  if (isHistoryName(receiver.name))
    return callHistoryMethod(interpreter.history, interpreter.origin, name, args, location);
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
  }
  if (isErrorConstructorName(name)) return createErrorValue(name, args, location);
  if (name === "import.meta.glob") return callImportMetaGlob(interpreter, args, context, location);
  if (isStringCodecName(name)) return callStringCodec(name, args, location);
  if (name === "Buffer.from") return createBufferValue(args, location);
  if (name === "Buffer.byteLength") return getBufferByteLength(args);
  const [first, second] = args;
  if (isConstructor && isTypedArrayName(name)) return constructTypedArray(name, first, location);
  if (isConstructor && isDomObserverName(name))
    return createDomObserver(interpreter, name, first, location);
  if (isConstructor && isNativeConstructorName(name) && (name !== "Date" || args.length > 0)) {
    const constructed = constructNativeObject(name, args);
    if (constructed) return constructed;
  }
  switch (name) {
    case "Function":
      return constructFunctionFromSource(interpreter, args, location);
    case "Object": {
      if (first === undefined || (first.kind === "primitive" && isNullish(first)))
        return objectValue([]);
      const firstTypeof = getTypeofValue(first, interpreter.getRealm(context.environment));
      if (
        firstTypeof.kind === "primitive" &&
        (firstTypeof.value === "object" || firstTypeof.value === "function")
      )
        return first;
      break;
    }
    case "String":
      return first ? toStringValue(first) : primitiveValue("");
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
      return createCollectionValue(name, first, location);
    case "URLSearchParams":
      return createSearchParamsValue(first, { location });
    case "URL":
      return createUrlValue(args, location);
    case "AbortController":
      if (isConstructor) return createAbortController(interpreter, location);
      break;
    case "RegExp": {
      if (second !== undefined && second.kind !== "primitive")
        return unknownValue("RegExp with dynamic flags", location);
      const flags = second?.value === undefined ? null : String(second.value);
      if (first?.kind === "regexp") {
        return { ...first, flags: flags ?? first.flags, lastIndex: 0 };
      }
      if (first?.kind === "primitive") {
        return { kind: "regexp", pattern: String(first.value), flags: flags ?? "", lastIndex: 0 };
      }
      return unknownValue("RegExp from a dynamic pattern", location);
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
        ? { kind: "symbol", key: first.value }
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
    case "Array.isArray":
      if (!first) return FALSE_VALUE;
      if (first.kind === "list" || first.kind === "repeat") return TRUE_VALUE;
      if (first.kind === "unknown" || first.kind === "branch") {
        return unknownPrimitiveValue("boolean", "Array.isArray on dynamic value");
      }
      return FALSE_VALUE;
    case "Array.from": {
      const source =
        first?.kind === "object" ? (getCollectionItems(first) ?? arrayLikeToList(first)) : first;
      if (source?.kind === "list" || source?.kind === "repeat") {
        if (isCallable(second)) return mapList(interpreter, source, second, context);
        return source;
      }
      return unknownValue("Array.from of dynamic iterable", location);
    }
    case "Object.keys":
    case "Object.values":
    case "Object.entries": {
      const ownEntries = first ? getOwnEnumerableEntries(first) : null;
      if (!ownEntries)
        return unknownValue(`${name} of ${first ? describeValue(first) : "nothing"}`, location);
      if (name === "Object.keys") return listValue(ownEntries.map(([key]) => primitiveValue(key)));
      if (name === "Object.values") return listValue(ownEntries.map(([, value]) => value));
      return listValue(ownEntries.map(([key, value]) => listValue([primitiveValue(key), value])));
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
      if (first?.kind === "object" && isBaseClassPrototype(first))
        return { kind: "global", name: "Object.prototype" };
      return getWitnessedPrototype(first, name, location);
    case "Object.getOwnPropertyNames":
    case "Object.getOwnPropertySymbols":
    case "Reflect.ownKeys": {
      if (first?.kind === "function") {
        return listValue(
          name === "Object.getOwnPropertySymbols"
            ? []
            : getFunctionOwnNames(first).map((key) => primitiveValue(key)),
        );
      }
      if (first?.kind !== "object" && first?.kind !== "list")
        return unknownValue(`${name} on a dynamic target`, location);
      const ownNames =
        name === "Object.getOwnPropertySymbols"
          ? []
          : (getOwnEnumerableEntries(first)
              ?.map(([key]) => key)
              .concat(first.kind === "list" ? ["length"] : []) ?? null);
      const ownSymbols =
        name === "Object.getOwnPropertyNames" || first.kind === "list"
          ? []
          : getKnownObjectSymbols(first);
      return ownNames && ownSymbols
        ? listValue([...ownNames.map((key) => primitiveValue(key)), ...ownSymbols])
        : unknownValue(`${name} on an object with dynamic spreads`, location);
    }
    case "Object.getOwnPropertyDescriptor": {
      const key = second ? getPropertyName(second) : null;
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
        if (!isNull && !isIntrinsicPrototype && prototype.kind !== "object")
          return unknownValue(`Object.create with ${describeValue(prototype)}`, location);
        const created: StaticObjectValue =
          prototype.kind === "object"
            ? { ...objectValue(), prototype }
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
    case "Object.defineProperty": {
      const descriptor = args[2];
      if (!first || second?.kind !== "primitive" || descriptor?.kind !== "object") {
        return first ?? unknownValue("Object.defineProperty on a dynamic target", location);
      }
      if (first.kind === "object") interpreter.recordHeapMutation(first);
      defineOwnProperty(interpreter, first, String(second.value), descriptor, context, location);
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
      const entries = first?.kind === "object" ? (getCollectionItems(first) ?? first) : first;
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
    case "parseInt":
    case "Number.parseInt":
      if (
        first?.kind === "primitive" &&
        typeof first.value !== "symbol" &&
        (second === undefined || second.kind === "primitive")
      ) {
        return primitiveValue(Number.parseInt(String(first.value), Number(second?.value ?? 10)));
      }
      return unknownPrimitiveValue("number", name);
    case "parseFloat":
    case "Number.parseFloat":
      if (first?.kind === "primitive" && typeof first.value !== "symbol")
        return primitiveValue(Number.parseFloat(String(first.value)));
      return unknownPrimitiveValue("number", name);
    case "isNaN":
    case "isFinite":
      if (first?.kind === "primitive" && typeof first.value !== "symbol") {
        const number = Number(first.value);
        return primitiveValue(name === "isNaN" ? Number.isNaN(number) : Number.isFinite(number));
      }
      return unknownPrimitiveValue("boolean", name);
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
      const json = first && args.length === 1 ? toJsonValue(first) : undefined;
      return json === undefined
        ? unknownPrimitiveValue("string", "JSON.stringify")
        : primitiveValue(JSON.stringify(json));
    }
    case "JSON.parse":
      if (first?.kind === "primitive" && typeof first.value === "string" && args.length === 1) {
        try {
          return jsonValue(JSON.parse(first.value));
        } catch {
          return unknownValue("JSON.parse threw", location);
        }
      }
      return unknownValue("JSON.parse", location);
    case "queueMicrotask":
      if (first) {
        interpreter.timers.queueMicrotask(() =>
          interpreter.callValue(first, [], context, location),
        );
      }
      return UNDEFINED_VALUE;
    case "setTimeout":
    case "setImmediate":
    case "requestAnimationFrame":
    case "requestIdleCallback": {
      // The runtime snapshot is taken once short timers settled; longer or dynamic delays may not have fired.
      const handle = interpreter.timers.createHandle(name);
      if (first) {
        if (isSettledDelay(second)) {
          interpreter.timers.schedule(handle, () =>
            interpreter.callValue(first, [], context, location),
          );
        } else interpreter.markEscaped(first);
      }
      return handle;
    }
    case "setInterval": {
      const handle = interpreter.timers.createHandle(name);
      if (first) {
        interpreter.timers.schedule(handle, () =>
          interpreter.runIntervalTicks(first, handle, context, location),
        );
      }
      return handle;
    }
    case "clearTimeout":
    case "clearInterval":
    case "cancelAnimationFrame":
    case "cancelIdleCallback":
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
  if (name === "Math.random") return rangedNumberValue(name, { min: 0, max: 1 });
  if (name.startsWith("Math.")) {
    const mathFunction: unknown = Reflect.get(Math, name.slice("Math.".length));
    const natives = toNativeArguments(args, null);
    return typeof mathFunction === "function" && natives !== null
      ? fromNativeValue(Reflect.apply(mathFunction, Math, natives), `${name}()`, null)
      : unknownPrimitiveValue("number", name);
  }
  if (isConstructor) return unknownValue(`new ${name}()`, location);
  return unknownValue(`${name}()`, location);
};

const MAX_ARRAY_LIKE_LENGTH = 1_000;

const arrayOfLength = (length: StaticValue, location: SourceLocation | null): StaticValue => {
  if (length.kind === "unknown-primitive" && length.primitiveType === "number")
    return { kind: "repeat", item: UNDEFINED_VALUE, location };
  if (length.kind === "unknown" || length.kind === "branch")
    return unknownValue("Array() with a dynamic length", location);
  if (length.kind !== "primitive" || typeof length.value !== "number") return listValue([length]);
  if (!Number.isInteger(length.value) || length.value < 0) {
    return thrownValue(
      "Array() with an invalid length",
      createErrorValue("RangeError", [primitiveValue("Invalid array length")], location),
      location,
    );
  }
  if (length.value > MAX_ARRAY_LIKE_LENGTH)
    return { kind: "repeat", item: UNDEFINED_VALUE, location };
  return listValue(Array.from({ length: length.value }, () => UNDEFINED_VALUE));
};

/** `new Uint16Array(length | array)`: a zero-filled or copied list; element coercion is not modeled. */
const constructTypedArray = (
  name: string,
  source: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  if (source === undefined) return listValue([]);
  if (source.kind === "list") return listValue([...source.items]);
  if (source.kind === "primitive" && typeof source.value === "number") {
    const zeroFilled = arrayOfLength(source, location);
    return zeroFilled.kind === "list"
      ? listValue(zeroFilled.items.map(() => primitiveValue(0)))
      : zeroFilled;
  }
  return unknownValue(`new ${name}() from ${describeValue(source)}`, location);
};

// `{ length: n }` (and sparse array-likes) as consumed by `Array.from`.
const arrayLikeToList = (value: Extract<StaticValue, { kind: "object" }>): StaticValue => {
  const length = getObjectProperty(value, "length");
  if (length.kind !== "primitive" || typeof length.value !== "number") {
    return unknownValue("Array.from of an array-like with dynamic length", null);
  }
  if (!Number.isInteger(length.value) || length.value < 0 || length.value > MAX_ARRAY_LIKE_LENGTH) {
    return { kind: "repeat", item: UNDEFINED_VALUE, location: null };
  }
  return listValue(
    Array.from({ length: length.value }, (_, index) => getObjectProperty(value, String(index))),
  );
};

export type CallableValue = Extract<
  StaticValue,
  { kind: "function" | "native-function" | "global" }
>;

const MAX_SETTLED_DELAY_MS = 2_000;

const isSettledDelay = (delay: StaticValue | undefined): boolean =>
  delay === undefined ||
  (delay.kind === "primitive" &&
    (delay.value === undefined ||
      delay.value === null ||
      (typeof delay.value === "number" && delay.value <= MAX_SETTLED_DELAY_MS)));

export const isCallable = (value: StaticValue | undefined): value is CallableValue =>
  value?.kind === "function" || value?.kind === "native-function" || value?.kind === "global";

/** Truthiness of `predicate(item, index, list)` per item; null where the analysis cannot decide. */
const testItems = (
  interpreter: Interpreter,
  list: StaticListValue,
  predicate: CallableValue,
  context: EvaluationContext,
): (boolean | null)[] =>
  list.items.map((item, index) =>
    getTruthiness(
      callCallback(interpreter, predicate, [item, primitiveValue(index), list], context),
    ),
  );

const callCallback = (
  interpreter: Interpreter,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue => interpreter.callValue(callback, args, context, null);

/** A callback run for an item that may occur zero or many times: its side effects are uncertain. */
export const callUncertainCallback = (
  interpreter: Interpreter,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue =>
  interpreter.runMaybe(
    callback.kind === "function" ? callback.scope : context.scope,
    () => callCallback(interpreter, callback, args, context),
    "callback for an item that may not occur",
    null,
  );

const mapList = (
  interpreter: Interpreter,
  receiver: StaticValue,
  callback: CallableValue,
  context: EvaluationContext,
): StaticValue => {
  if (receiver.kind === "list") {
    return listValue(
      receiver.items.map((item, index) => {
        if (item.kind === "repeat") {
          return {
            kind: "repeat",
            item: callUncertainCallback(
              interpreter,
              callback,
              [item.item, unknownPrimitiveValue("number", "index"), receiver],
              context,
            ),
            location: item.location,
          };
        }
        if (item.kind === "optional") {
          return optionalValue(
            callUncertainCallback(
              interpreter,
              callback,
              [item.value, unknownPrimitiveValue("number", "index"), receiver],
              context,
            ),
            item.reason,
            item.location,
          );
        }
        return callCallback(
          interpreter,
          callback,
          [item, primitiveValue(index), receiver],
          context,
        );
      }),
    );
  }
  if (receiver.kind === "repeat") {
    return {
      kind: "repeat",
      item: callUncertainCallback(
        interpreter,
        callback,
        [receiver.item, unknownPrimitiveValue("number", "index"), receiver],
        context,
      ),
      location: receiver.location,
    };
  }
  return {
    kind: "repeat",
    item: callUncertainCallback(
      interpreter,
      callback,
      [
        unknownValue(`item of ${describeValue(receiver)}`),
        unknownPrimitiveValue("number", "index"),
        receiver,
      ],
      context,
    ),
    location: null,
  };
};

const toRegExp = (value: StaticRegExpValue): RegExp | null => {
  try {
    return new RegExp(value.pattern, value.flags);
  } catch {
    return null;
  }
};

const toPattern = (value: StaticValue): string | RegExp | null => {
  if (value.kind === "primitive") return String(value.value);
  if (value.kind === "regexp") return toRegExp(value);
  return null;
};

const listOfStrings = (parts: (string | undefined)[]): StaticListValue =>
  listValue(parts.map((part) => (part === undefined ? UNDEFINED_VALUE : primitiveValue(part))));

const dynamicSplitResult = (location: SourceLocation | null): StaticListValue =>
  listValue([
    { kind: "repeat", item: unknownPrimitiveValue("string", "split of dynamic string"), location },
  ]);

/** `String.prototype.replace` with a callback needs the callback to produce a known string on every match. */
const replaceWithCallback = (
  interpreter: Interpreter,
  receiver: string,
  pattern: string | RegExp,
  replacer: StaticFunctionValue,
  context: EvaluationContext,
  replaceAll: boolean,
): StaticValue | null => {
  let isKnown = true;
  const replaceMatch = (...matchArgs: (string | number)[]): string => {
    const result = interpreter.callFunction(
      replacer,
      matchArgs.map((matchArg) => primitiveValue(matchArg)),
      context,
    );
    if (result.kind === "primitive") return String(result.value);
    isKnown = false;
    return "";
  };
  const replaced = replaceAll
    ? receiver.replaceAll(pattern, replaceMatch)
    : receiver.replace(pattern, replaceMatch);
  return isKnown ? primitiveValue(replaced) : null;
};

const callStringMethod = (
  interpreter: Interpreter,
  receiver: string,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue | null => {
  const [first, second] = args;
  const primitiveArgs = args.map((argument) =>
    argument.kind === "primitive" ? argument.value : undefined,
  );
  const allKnown = args.every((argument) => argument.kind === "primitive");
  if (name === "split" || name === "replace" || name === "replaceAll") {
    const pattern = first ? toPattern(first) : null;
    if (pattern === null) return first ? null : listOfStrings([receiver]);
    if (name === "split") {
      const limit = second?.kind === "primitive" ? Number(second.value) : undefined;
      return listOfStrings(receiver.split(pattern, limit));
    }
    if (second?.kind === "function") {
      return replaceWithCallback(
        interpreter,
        receiver,
        pattern,
        second,
        context,
        name === "replaceAll",
      );
    }
    if (second?.kind !== "primitive") return null;
    const replacement = String(second.value);
    return primitiveValue(
      name === "replace"
        ? receiver.replace(pattern, replacement)
        : receiver.replaceAll(pattern, replacement),
    );
  }
  if (name === "match" && first?.kind === "regexp") {
    const regExp = toRegExp(first);
    if (!regExp) return null;
    const matched = receiver.match(regExp);
    return matched ? listOfStrings([...matched]) : NULL_VALUE;
  }
  if (!allKnown) return null;
  const position = primitiveArgs[1] === undefined ? undefined : Number(primitiveArgs[1]);
  switch (name) {
    case "toUpperCase":
      return primitiveValue(receiver.toUpperCase());
    case "toLowerCase":
      return primitiveValue(receiver.toLowerCase());
    case "trim":
      return primitiveValue(receiver.trim());
    case "trimStart":
      return primitiveValue(receiver.trimStart());
    case "trimEnd":
      return primitiveValue(receiver.trimEnd());
    case "slice":
    case "substring":
      return primitiveValue(
        name === "slice"
          ? receiver.slice(Number(primitiveArgs[0] ?? 0), position)
          : receiver.substring(Number(primitiveArgs[0] ?? 0), position),
      );
    case "charAt":
      return primitiveValue(receiver.charAt(Number(primitiveArgs[0] ?? 0)));
    case "charCodeAt":
      return primitiveValue(receiver.charCodeAt(Number(primitiveArgs[0] ?? 0)));
    case "codePointAt": {
      const codePoint = receiver.codePointAt(Number(primitiveArgs[0] ?? 0));
      return codePoint === undefined ? UNDEFINED_VALUE : primitiveValue(codePoint);
    }
    case "at": {
      const character = receiver.at(Number(primitiveArgs[0] ?? 0));
      return character === undefined ? UNDEFINED_VALUE : primitiveValue(character);
    }
    case "indexOf":
      return primitiveValue(receiver.indexOf(String(primitiveArgs[0]), position));
    case "lastIndexOf":
      return primitiveValue(receiver.lastIndexOf(String(primitiveArgs[0]), position));
    case "padStart":
      return primitiveValue(
        receiver.padStart(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
    case "padEnd":
      return primitiveValue(
        receiver.padEnd(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
    case "includes":
      return primitiveValue(receiver.includes(String(primitiveArgs[0]), position));
    case "startsWith":
      return primitiveValue(receiver.startsWith(String(primitiveArgs[0]), position));
    case "endsWith":
      return primitiveValue(receiver.endsWith(String(primitiveArgs[0]), position));
    case "toString":
    case "valueOf":
      return primitiveValue(receiver);
    case "concat":
      return primitiveValue(receiver + primitiveArgs.map(String).join(""));
    case "repeat":
      return primitiveValue(receiver.repeat(Number(primitiveArgs[0] ?? 0)));
    case "localeCompare":
      return primitiveValue(receiver.localeCompare(String(primitiveArgs[0])));
    default:
      return null;
  }
};

const callNumberMethod = (
  receiver: number | boolean | bigint,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  const [first] = args;
  if (first !== undefined && first.kind !== "primitive") return null;
  const digits = first === undefined ? undefined : Number(first.value);
  switch (name) {
    case "toString":
      return primitiveValue(
        typeof receiver === "boolean" ? receiver.toString() : receiver.toString(digits),
      );
    case "valueOf":
      return primitiveValue(receiver);
    case "toFixed":
      return typeof receiver === "number" ? primitiveValue(receiver.toFixed(digits)) : null;
    case "toPrecision":
      return typeof receiver === "number" ? primitiveValue(receiver.toPrecision(digits)) : null;
    default:
      return null;
  }
};

const callRegExpMethod = (
  receiver: StaticRegExpValue,
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [first] = args;
  const regExp = toRegExp(receiver);
  if (!regExp) return unknownValue(`invalid RegExp /${receiver.pattern}/`, location);
  if (name !== "test" && name !== "exec") return unknownValue(`RegExp.${name}()`, location);
  if (first?.kind === "branch" && !regExp.global && !regExp.sticky) {
    return mapValue(first, (alternative) =>
      callRegExpMethod(receiver, name, [alternative], location),
    );
  }
  if (first?.kind !== "primitive") {
    return name === "test"
      ? unknownPrimitiveValue("boolean", "RegExp.test() on a dynamic string")
      : unknownValue("RegExp.exec() on a dynamic string", location);
  }
  const input = String(first.value);
  regExp.lastIndex = receiver.lastIndex;
  const matched = regExp.exec(input);
  receiver.lastIndex = regExp.lastIndex;
  if (name === "test") return primitiveValue(matched !== null);
  if (!matched) return NULL_VALUE;
  return {
    ...listOfStrings([...matched]),
    properties: new Map([
      ["index", primitiveValue(matched.index)],
      ["input", primitiveValue(input)],
    ]),
  };
};

const fallbackMethodResult = (
  receiver: StaticValue,
  name: string,
  location: SourceLocation | null,
): StaticValue => {
  if (name === "split") return dynamicSplitResult(location);
  if (
    LIST_PRESERVING_METHODS.has(name) &&
    (receiver.kind === "unknown" || receiver.kind === "repeat")
  ) {
    return receiver;
  }
  return (
    getLanguageMethodResult(receiver, name) ??
    unknownValue(`${describeValue(receiver)}.${name}()`, location)
  );
};

const promiseTools = (
  interpreter: Interpreter,
  context: EvaluationContext,
  location: SourceLocation | null,
): PromiseTools => ({
  call: (callee, callArgs) => interpreter.callValue(callee, callArgs, context, location),
  markEscaped: (value) => interpreter.markEscaped(value),
  queueMicrotask: (task) => interpreter.timers.queueMicrotask(task),
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
  if (modeled) return chainPromise(modeled, handlers, promiseTools(interpreter, context, location));
  if (receiver.kind === "unknown" || receiver.kind === "external") {
    if (handlers.onFulfilled?.kind === "function")
      return interpreter.callDeferred(handlers.onFulfilled, [receiver], context);
    for (const handler of [handlers.onFulfilled, handlers.onRejected, handlers.onFinally]) {
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
  const [first, second] = bindCallbackThisArg(name, args);

  if (isPromiseMethodName(name))
    return callPromiseMethod(interpreter, receiver, name, args, context, location);

  if (name === "toString" && args.length === 0) {
    const sourceText = getFunctionSourceText(receiver);
    if (sourceText !== null) return primitiveValue(sourceText);
  }

  if (receiver.kind === "function") {
    if (name === "bind") {
      return {
        ...receiver,
        name: `bound ${receiver.name ?? ""}`,
        properties: new Map(),
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

  if ((name === "hasOwnProperty" || name === "propertyIsEnumerable") && first !== undefined) {
    const ownProperty = hasOwnProperty(receiver, first, name);
    if (ownProperty) return ownProperty;
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
  );
  if (listened) return listened;

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
    if (name === "call") return interpreter.callValue(receiver, args.slice(1), context, location);
    if (name === "apply") {
      return interpreter.callValue(
        receiver,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        location,
      );
    }
    if (name === "bind") {
      if (receiver.kind !== "method") return receiver;
      const boundArgs = args.slice(1);
      return nativeFunction(`bound ${receiver.name}`, (callArgs, tools) =>
        tools.call(receiver, [...boundArgs, ...callArgs]),
      );
    }
  }

  if (receiver.kind === "primitive") {
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
  }

  if (name === "map" && isCallable(first)) return mapList(interpreter, receiver, first, context);

  if (name === "forEach" && isCallable(first)) {
    if (receiver.kind === "list") {
      receiver.items.forEach((item, index) => {
        if (item.kind === "repeat" || item.kind === "optional") {
          callUncertainCallback(
            interpreter,
            first,
            [
              item.kind === "repeat" ? item.item : item.value,
              unknownPrimitiveValue("number", "index"),
              receiver,
            ],
            context,
          );
        } else callCallback(interpreter, first, [item, primitiveValue(index), receiver], context);
      });
    } else if (receiver.kind === "repeat") {
      callUncertainCallback(
        interpreter,
        first,
        [receiver.item, unknownPrimitiveValue("number", "index"), receiver],
        context,
      );
    }
    return UNDEFINED_VALUE;
  }

  if (name === "flatMap" && isCallable(first)) {
    const mapped = mapList(interpreter, receiver, first, context);
    if (mapped.kind === "list") {
      return listValue(mapped.items.flatMap((item) => flattenOneLevel(item, location)));
    }
    return mapped;
  }

  if (receiver.kind === "list") {
    switch (name) {
      case "filter":
        if (isCallable(first) && hasDefiniteItems(receiver)) {
          const kept: StaticValue[] = [];
          receiver.items.forEach((item, index) => {
            const verdict = getTruthiness(
              callCallback(interpreter, first, [item, primitiveValue(index), receiver], context),
            );
            if (verdict === true) kept.push(item);
            else if (verdict === null) kept.push(optionalValue(item, "uncertain filter"));
          });
          return listValue(kept);
        }
        return receiver;
      case "slice": {
        if (!isKnownList(receiver)) return receiver;
        const start = first?.kind === "primitive" ? Number(first.value) : undefined;
        const end = second?.kind === "primitive" ? Number(second.value) : undefined;
        if (first && start === undefined)
          return unknownValue("slice with dynamic bounds", location);
        return listValue(receiver.items.slice(start, end));
      }
      case "concat": {
        return listValue([
          ...receiver.items,
          ...args.flatMap((argument) => flattenOneLevel(argument, location)),
        ]);
      }
      case "reverse":
        interpreter.recordHeapMutation(receiver);
        receiver.items.reverse();
        return receiver;
      case "fill": {
        if (!isKnownList(receiver) || first === undefined) return receiver;
        if (second !== undefined || args.length > 2)
          return unknownValue("fill with a range", location);
        interpreter.recordHeapMutation(receiver);
        receiver.items.fill(first);
        return receiver;
      }
      case "toReversed":
        return listValue([...receiver.items].reverse());
      case "sort":
      case "toSorted":
        return receiver;
      case "flat": {
        const items: StaticValue[] = [];
        for (const item of receiver.items) {
          if (item.kind === "list") items.push(...item.items);
          else items.push(item);
        }
        return listValue(items);
      }
      case "join":
        if (receiver.items.every((item) => item.kind === "primitive")) {
          const separator = first?.kind === "primitive" ? String(first.value) : ",";
          return primitiveValue(
            receiver.items
              .map((item) => (item.kind === "primitive" ? String(item.value ?? "") : ""))
              .join(separator),
          );
        }
        return unknownPrimitiveValue("string", "join of dynamic list");
      case "at": {
        if (first?.kind === "primitive" && isKnownList(receiver)) {
          const index = Number(first.value);
          return receiver.items.at(index) ?? UNDEFINED_VALUE;
        }
        return unknownValue("at() with dynamic index", location);
      }
      case "includes":
      case "indexOf": {
        if (!first || !hasDefiniteItems(receiver)) break;
        if (
          second !== undefined &&
          (second.kind !== "primitive" || typeof second.value !== "number")
        )
          break;
        const fromIndex =
          second?.kind === "primitive" && typeof second.value === "number"
            ? Math.max(0, second.value < 0 ? receiver.items.length + second.value : second.value)
            : 0;
        const verdicts = receiver.items
          .slice(fromIndex)
          .map((item) => compareIdentity(item, first));
        const foundIndex = verdicts.indexOf(true);
        if (
          foundIndex !== -1 &&
          verdicts.slice(0, foundIndex).every((verdict) => verdict === false)
        ) {
          return name === "includes" ? TRUE_VALUE : primitiveValue(foundIndex + fromIndex);
        }
        if (verdicts.every((verdict) => verdict === false)) {
          return name === "includes" ? FALSE_VALUE : primitiveValue(-1);
        }
        break;
      }
      case "some":
      case "every": {
        if (!isCallable(first) || !hasDefiniteItems(receiver)) break;
        const isSome = name === "some";
        const verdicts = testItems(interpreter, receiver, first, context);
        if (verdicts.some((verdict) => verdict === isSome))
          return isSome ? TRUE_VALUE : FALSE_VALUE;
        if (verdicts.every((verdict) => verdict !== null)) return isSome ? FALSE_VALUE : TRUE_VALUE;
        return unknownPrimitiveValue("boolean", `${name}() with an uncertain predicate`);
      }
      case "find":
      case "findLast":
      case "findIndex":
      case "findLastIndex": {
        const isIndex = name.endsWith("Index");
        const missing = isIndex ? primitiveValue(-1) : UNDEFINED_VALUE;
        if (!isCallable(first) || !hasDefiniteItems(receiver)) {
          if (isIndex) break;
          const candidates = receiver.items.filter((item) => item.kind !== "repeat");
          return branchValue([...candidates, missing], `${name}()`, location);
        }
        const verdicts = testItems(interpreter, receiver, first, context);
        const order = name.includes("Last")
          ? verdicts.map((_, index) => verdicts.length - 1 - index)
          : verdicts.map((_, index) => index);
        const candidates: StaticValue[] = [];
        for (const index of order) {
          if (verdicts[index] === false) continue;
          candidates.push(isIndex ? primitiveValue(index) : receiver.items[index]);
          if (verdicts[index] === true) return branchValue(candidates, `${name}()`, location);
        }
        return branchValue([...candidates, missing], `${name}()`, location);
      }
      case "reduce":
      case "reduceRight": {
        if (!isCallable(first) || !hasDefiniteItems(receiver)) {
          return unknownValue(`${name}()`, location);
        }
        const items = name === "reduce" ? receiver.items : [...receiver.items].reverse();
        let accumulator = args.length > 1 ? second : items[0];
        if (!accumulator) return unknownValue(`${name}() of an empty list`, location);
        const startIndex = args.length > 1 ? 0 : 1;
        for (let index = startIndex; index < items.length; index++) {
          const sourceIndex = name === "reduce" ? index : items.length - 1 - index;
          accumulator = callCallback(
            interpreter,
            first,
            [accumulator, items[index], primitiveValue(sourceIndex), receiver],
            context,
          );
        }
        return accumulator;
      }
      case "push":
      case "unshift": {
        // Inside an uncertain path (e.g. a loop of unknown length) the pushed
        // items may occur any number of times, so they become a repeat.
        const pushed: StaticValue[] =
          context.uncertainDepth > 0
            ? [{ kind: "repeat", item: args.length === 1 ? args[0] : listValue(args), location }]
            : args;
        interpreter.recordHeapMutation(receiver);
        if (name === "push") receiver.items.push(...pushed);
        else receiver.items.unshift(...pushed);
        return getListLength(receiver);
      }
      case "pop":
      case "shift": {
        interpreter.recordHeapMutation(receiver);
        if (hasDefiniteItems(receiver) && context.uncertainDepth === 0) {
          const removed = name === "pop" ? receiver.items.pop() : receiver.items.shift();
          return removed ?? UNDEFINED_VALUE;
        }
        receiver.items = receiver.items.map((item) =>
          isIndefiniteItem(item) ? item : optionalValue(item, `uncertain ${name}()`, location),
        );
        return unknownValue(`${name}() of an uncertain list`, location);
      }
      case "splice": {
        interpreter.recordHeapMutation(receiver);
        const start = first?.kind === "primitive" ? Number(first.value) : Number.NaN;
        const deleteCount =
          second === undefined
            ? receiver.items.length
            : second.kind === "primitive"
              ? Number(second.value)
              : Number.NaN;
        if (
          hasDefiniteItems(receiver) &&
          context.uncertainDepth === 0 &&
          Number.isInteger(start) &&
          Number.isInteger(deleteCount)
        ) {
          return listValue(receiver.items.splice(start, deleteCount, ...args.slice(2)));
        }
        receiver.items = [
          ...receiver.items.map((item) =>
            isIndefiniteItem(item) ? item : optionalValue(item, "uncertain splice()", location),
          ),
          ...args
            .slice(2)
            .map((inserted): StaticValue => ({ kind: "repeat", item: inserted, location })),
        ];
        return unknownValue("splice() of an uncertain list", location);
      }
      default:
        break;
    }
  }

  return fallbackMethodResult(receiver, name, location);
};
