import type { HostDocument } from "../host/host-document.js";
import type { GuardContext } from "../symbolic/guards.js";
import type { HostRealm } from "../host/host-realm.js";
import type { SourceLocation } from "../parse/source-types.js";
import type {
  JournaledState,
  ProjectContext,
  ReactApi,
  RenderEnvironment,
  StaticAccessor,
  StaticElementValue,
  StaticFunctionValue,
  StaticGlobalValue,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticValue,
} from "../types.js";
import { createAbortController } from "./abort-controller.js";
import { callWithArgumentList } from "./array-like.js";
import { reflectConstruct } from "./reflect-construct.js";
import { callArrayFrom } from "./array-from.js";
import {
  type ArrayMethodEvaluator,
  arrayOfLength,
  callArrayMethod,
  groupItems,
} from "./array-methods.js";
import { createBlobValue } from "./blob.js";
import {
  callHotModuleMethod,
  getBundlerGlobal,
  type EnvironmentLookup,
} from "./bundler-globals.js";
import { getClassPrototypeObject } from "./class-component.js";
import {
  cloneDateValue,
  createClockDateValue,
  createUnknownDateValue,
  isClockReading,
  toDatePrimitive,
} from "./clock-date.js";
import { parseSerializedJson, stringifyJsonValue } from "./json-values.js";
import { createCollectionValue, getCollectionItems } from "./collections.js";
import type {
  EvaluationContext,
  FunctionCaller,
  FunctionFactory,
  PropertyAssigner,
} from "./context.js";
import type { MutableHeapValue } from "./heap-journal.js";
import type { ModuleEvaluator } from "./module-evaluator.js";
import type { TimerQueue } from "./timers.js";
import { createDomObserver, isDomObserverName } from "./dom-observers.js";
import {
  createErrorValue,
  getErrorText,
  getErrorWitness,
  getIntrinsicConstructionError,
  isErrorConstructorName,
} from "./errors.js";
import { callEventTargetMethod, type EventListenerEvaluator } from "./event-listeners.js";
import { callFetch } from "./fetch.js";
import { constructFunctionFromSource } from "./function-constructor.js";
import { bindFunction } from "./function-bind.js";
import {
  getFunctionOwnPresence,
  isIntrinsicFunctionKey,
  ownsNoFunctionTextKey,
} from "./has-property.js";
import {
  constructDeclaredHostObject,
  getHostGlobal,
  getLanguageMethodResult,
  GLOBAL_OBJECT_VALUE,
} from "./host-globals.js";
import { createImageElement, type ImageLoadHost } from "./image-loading.js";
import { callImportMetaGlob } from "./import-glob.js";
import {
  callIndexedDbMethod,
  isIndexedDbName,
  type IndexedDbHost,
  type createIndexedDbFactory,
} from "./indexed-db.js";
import { getBuiltinPrototypeName, getPrototypeWitness, isPrototypeOf } from "./instance-of.js";
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
import { getOwnEnumerableEntries as getModeledOwnEnumerableEntries } from "./own-entries.js";
import { enumerateOwnObject } from "./own-enumeration.js";
import { assignObjectSource } from "./object-copy.js";
import { recordInputSource } from "./predicates.js";
import {
  getNextObjectIntegrity,
  getObjectExtensibility,
  getObjectIntegrityTest,
} from "./object-integrity.js";
import {
  getPropertyDefinition,
  getProxyDefinitionPermission,
  readPropertyDescriptor,
  type PropertyDescriptorEvaluator,
} from "./property-descriptors.js";
import {
  callShapedPrimitiveMethod,
  getFunctionText,
  isFunctionText,
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
import { callHistoryMethod, isHistoryName, type SessionHistory } from "./session-history.js";
import {
  callNumberMethod,
  callRegExpMethod,
  callStringMethod,
  dynamicSplitResult,
  type StringMethodEvaluator,
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
  convertTypedElements,
  constructBinary,
  isBinaryView,
  isTypedArrayName,
} from "./typed-arrays.js";
import { createSearchParamsValue } from "./url-search-params.js";
import { createUrlValue } from "./url.js";
import { isPrimitiveBranch, MAX_DISTRIBUTED_ALTERNATIVES } from "./value-distribution.js";
import { getTypeofValue } from "./value-typeof.js";
import { createAudioContext, createAudioWorkletNode } from "./web-audio.js";
import {
  branchValue,
  getSameValueComparison,
  createRegisteredSymbolValue,
  createSymbolValue,
  describeValue,
  distributeBinary,
  distributeObjectBranches,
  FALSE_VALUE,
  getClassPrototype,
  getKnownObjectKeys,
  getKnownObjectOwnNames,
  getKnownObjectSymbols,
  getObjectProperty,
  getOwnPropertyDescriptor,
  getOwnPropertyCandidates,
  getTruthinessCases,
  getOwnPropertyPresence,
  getObjectAccessor,
  getPropertyName,
  getPropertyKeyValue,
  getSymbolDescription,
  getSymbolPropertyKey,
  getTruthiness,
  hasDefiniteItems,
  isCallable,
  isUndefinedValue,
  isSameValue,
  isIndefiniteItem,
  isNullish,
  isSymbolPropertyKey,
  jsonValue,
  joinMappedAlternatives,
  listValue,
  mapFiniteListItems,
  mapValue,
  nativeObjectValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  thrownValue,
  toBooleanValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";
import { callWebCryptoMethod, isWebCryptoName } from "./web-crypto.js";
import { callStorageMethod, getStorageAreaName, type StorageAreas } from "./web-storage.js";

export interface BuiltinEvaluator
  extends
    ArrayMethodEvaluator,
    StringMethodEvaluator,
    PropertyDescriptorEvaluator,
    PropertyAssigner,
    FunctionCaller,
    FunctionFactory,
    ModuleEvaluator,
    EventListenerEvaluator {
  readonly project: Pick<ProjectContext, "readServedAsset">;
  readonly origin: string | null;
  readonly history: SessionHistory;
  readonly indexedDb: ReturnType<typeof createIndexedDbFactory>;
  readonly storageAreas: StorageAreas;
  readonly timers: TimerQueue;
  getProxyMethod: (
    handler: StaticObjectValue,
    name: string,
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;
  getRealm: (environment: RenderEnvironment | null) => HostRealm;
  recordHeapMutation: (target: MutableHeapValue) => void;
  assignOwnProperty: (
    target: StaticObjectValue,
    key: string,
    value: StaticValue,
    accessor?: StaticAccessor,
  ) => void;
  setReactApiProperty: (
    api: ReactApi,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ) => void;
  setGlobalMember: (
    target: StaticGlobalValue,
    key: string,
    value: StaticValue,
    context: EvaluationContext,
  ) => void;
  materializeNamespace: (value: StaticValue, environment: RenderEnvironment | null) => StaticValue;
  constructSuper: (
    instance: StaticValue,
    callee: StaticValue,
    args: StaticValue[],
  ) => StaticValue | null;
  construct: (
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;
  callDeferred: (
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;
  runIntervalTicks: (
    callback: StaticValue,
    handle: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
    isDeferred: boolean,
    callbackArguments?: StaticValue[],
  ) => void;
  runTimerTask: (
    handle: StaticValue,
    context: EvaluationContext | null,
    location: SourceLocation | null,
    task: () => void,
  ) => void;
  queueMicrotask: (
    task: () => void,
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => void;
  bindTask: <Arguments extends unknown[]>(
    task: (...args: Arguments) => void,
    context: EvaluationContext | null,
    location: SourceLocation | null,
  ) => (...args: Arguments) => void;
  runTaskWithCause: (
    cause: GuardContext,
    task: () => void,
    context?: EvaluationContext | null,
    location?: SourceLocation | null,
  ) => void;
  runTaskAlternatives: (
    causes: readonly GuardContext[],
    task: (index: number) => void,
    reason: string,
    context?: EvaluationContext | null,
    location?: SourceLocation | null,
  ) => void;
  recordStateMutation: (state: JournaledState<unknown>) => void;
}

/** An unknown number that is neither NaN nor infinite: a clock reading, or one the analysis bounded. */
const isFiniteUnknownNumber = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" &&
  (value.clock !== undefined ||
    (value.numberRange !== undefined &&
      Number.isFinite(value.numberRange.min) &&
      Number.isFinite(value.numberRange.max)));

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
      preservesDescriptors: true,
      value: branchValue(
        [objectValue([present]), objectValue([])],
        pair.reason,
        pair.location,
        pair.isAbsentPreferred ? 1 : 0,
        pair.predicate,
      ),
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
      preservesDescriptors: true,
      value: joinMappedAlternatives(
        pair,
        alternatives.map((entry) => objectValue([entry])),
      ),
    };
  }
  if (!hasDefiniteItems(pair)) return null;
  const [key = UNDEFINED_VALUE, value = UNDEFINED_VALUE] = pair.items;
  if (key.kind === "branch")
    return getEntryFromPair(mapValue(key, (alternative) => listValue([alternative, value])));
  const name = getPropertyName(key);
  return name === null ? null : { kind: "property", key: name, value };
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
  const dateTime = toDatePrimitive(value, "number");
  if (dateTime !== null) return toNumberValue(dateTime);
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

const readDescriptorValue = (
  evaluator: BuiltinEvaluator,
  target: StaticValue,
  descriptor: StaticObjectValue,
  key: string,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const keys = getKnownObjectKeys(descriptor);
  if (keys?.includes("value")) return getObjectProperty(descriptor, "value");
  if (keys?.includes("get")) {
    return evaluator.callValue(getObjectProperty(descriptor, "get"), [], context, location, {
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
  evaluator: BuiltinEvaluator,
  target: StaticValue,
  key: string,
  descriptor: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (descriptor.kind === "branch") {
    return evaluator.callAlternatives(descriptor, context, (alternative, alternativeContext) =>
      defineOwnProperty(evaluator, target, key, alternative, alternativeContext, location),
    );
  }
  if (descriptor.kind !== "object") return unknownValue("unresolved property descriptor", location);
  if (target.kind === "proxy") {
    return evaluator.continueValue(
      evaluator.getProxyMethod(target.handler, "defineProperty", context, location),
      context,
      (method, methodContext) => {
        if (isUndefinedValue(method))
          return evaluator.continueValue(
            defineOwnProperty(evaluator, target.target, key, descriptor, methodContext, location),
            methodContext,
            () => target,
          );
        const converted = objectValue([...descriptor.entries]);
        return evaluator.continueValue(
          evaluator.callValue(
            method,
            [target.target, getPropertyKeyValue(key), converted],
            methodContext,
            location,
            { thisValue: target.handler },
          ),
          methodContext,
          (result, resultContext) =>
            evaluator.continueValue(
              getTruthinessCases(result),
              resultContext,
              (accepted, acceptedContext) => {
                const failure = (): StaticValue => {
                  const reason = `Proxy defineProperty trap rejected ${key}`;
                  return thrownValue(
                    reason,
                    createErrorValue("TypeError", [primitiveValue(reason)], location),
                    location,
                  );
                };
                if (getTruthiness(accepted) === false) return failure();
                if (target.target.kind !== "object") return target;
                const backing = target.target;
                const previous = getOwnPropertyDescriptor(backing, key);
                if (!previous)
                  return unknownValue("unresolved proxy definition invariants", location);
                return evaluator.continueValue(
                  previous,
                  acceptedContext,
                  (metadata, metadataContext) =>
                    evaluator.continueValue(
                      getTruthinessCases(
                        getProxyDefinitionPermission(backing, key, descriptor, metadata, location),
                      ),
                      metadataContext,
                      (permission) => (getTruthiness(permission) === true ? target : failure()),
                    ),
                );
              },
            ),
        );
      },
    );
  }
  if (target.kind === "function") {
    return evaluator.continueValue(
      defineOwnProperty(evaluator, target.properties, key, descriptor, context, location),
      context,
      () => {
        if (key === "name") {
          const value = getObjectProperty(target.properties, key);
          if (value.kind === "primitive" && typeof value.value === "string")
            target.name = value.value;
        }
        return target;
      },
    );
  }
  const isEnumerable = isEnumerableDescriptor(descriptor);
  if (target.kind === "object") {
    const previous = getOwnPropertyDescriptor(target, key);
    if (previous === null)
      return unknownValue("Object.defineProperty with an unresolved descriptor", location);
    return evaluator.continueValue(previous, context, (previousDescriptor, previousContext) => {
      const definition = getPropertyDefinition(
        target,
        key,
        descriptor,
        location,
        previousDescriptor,
      );
      if (!definition)
        return unknownValue("Object.defineProperty with an unresolved descriptor", location);
      return evaluator.continueValue(definition.permission, previousContext, (permission) => {
        if (getTruthiness(permission) !== true) {
          const reason = `Cannot redefine property: ${key}`;
          return thrownValue(
            reason,
            createErrorValue("TypeError", [primitiveValue(reason)], location),
            location,
          );
        }
        evaluator.recordHeapMutation(target);
        target.entries.push(definition.entry);
        return target;
      });
    });
  }
  if (target.kind === "list") evaluator.recordHeapMutation(target);
  const value = readDescriptorValue(evaluator, target, descriptor, key, context, location);
  switch (target.kind) {
    case "class":
      if (key === "name") {
        if (value.kind === "primitive" && typeof value.value === "string")
          target.name = value.value;
        return target;
      }
      evaluator.assignOwnProperty(target.properties, key, value);
      return target;
    case "react-api":
      evaluator.setReactApiProperty(target.api, key, value, context);
      return target;
    case "global":
      evaluator.setGlobalMember(target, key, value, context);
      return target;
    case "list": {
      if (target.isFrozen || Number.isInteger(Number(key)) || key === "length") return target;
      target.properties ??= new Map();
      target.properties.set(key, value);
      if (!isEnumerable) (target.nonEnumerableKeys ??= new Set()).add(key);
      return target;
    }
    default:
      return target;
  }
};

const defineOwnProperties = (
  evaluator: BuiltinEvaluator,
  target: StaticValue,
  descriptors: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue =>
  evaluator.continueValue(descriptors, context, (dictionary, dictionaryContext) => {
    if (dictionary.kind !== "object")
      return unknownValue("Object.defineProperties with an unresolved dictionary", location);
    const keys = getOwnPropertyCandidates(dictionary);
    if (!keys) return unknownValue("Object.defineProperties with unresolved keys", location);
    let collected: StaticValue = objectValue();
    for (const key of keys) {
      collected = evaluator.continueValue(
        collected,
        dictionaryContext,
        (previous, propertyContext) => {
          if (previous.kind !== "object") return previous;
          const own = getOwnPropertyDescriptor(dictionary, key);
          if (own === null) return unknownValue("unresolved descriptor dictionary entry", location);
          return evaluator.continueValue(own, propertyContext, (metadata, metadataContext) => {
            if (metadata.kind !== "object") return isUndefinedValue(metadata) ? previous : metadata;
            return evaluator.continueValue(
              getTruthinessCases(getObjectProperty(metadata, "enumerable")),
              metadataContext,
              (enumerable, enumerableContext) => {
                if (getTruthiness(enumerable) === false) return previous;
                return evaluator.continueValue(
                  evaluator.getProperty(dictionary, key, enumerableContext, location),
                  enumerableContext,
                  (descriptor, descriptorContext) =>
                    evaluator.continueValue(
                      readPropertyDescriptor(evaluator, descriptor, descriptorContext, location),
                      descriptorContext,
                      (normalized) =>
                        normalized.kind === "object"
                          ? objectValue([
                              ...previous.entries,
                              { kind: "property", key, value: normalized },
                            ])
                          : normalized,
                    ),
                );
              },
            );
          });
        },
      );
    }
    return evaluator.continueValue(collected, dictionaryContext, (prepared, preparedContext) => {
      if (prepared.kind !== "object") return prepared;
      let result = target;
      for (const entry of prepared.entries) {
        if (entry.kind !== "property") return unknownValue("unresolved descriptor entry", location);
        result = evaluator.continueValue(result, preparedContext, (current, propertyContext) =>
          defineOwnProperty(evaluator, current, entry.key, entry.value, propertyContext, location),
        );
      }
      return result;
    });
  });

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
  const names = callable.hasStoredMetadata ? [] : ["length", "name"];
  if (!callable.hasStoredMetadata && isIntrinsicFunctionKey(callable, "prototype"))
    names.push("prototype");
  for (const key of ownKeys) {
    if (!names.includes(key) && !isSymbolPropertyKey(key)) names.push(key);
  }
  return names;
};

const getFunctionOwnPropertyDescriptor = (
  evaluator: BuiltinEvaluator,
  callable: StaticFunctionValue,
  key: string,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (getObjectAccessor(callable.properties, key))
    return (
      getOwnPropertyDescriptor(callable.properties, key) ??
      unknownValue("descriptor of a partially known function", location)
    );
  const ownNames = getFunctionOwnNames(callable);
  if (!ownNames) return unknownValue(`descriptor of a partially known function`, location);
  if (!ownNames.includes(key)) return UNDEFINED_VALUE;
  const isIntrinsic = isIntrinsicFunctionKey(callable, key);
  return objectFromRecord({
    value: evaluator.getProperty(callable, key, context, location),
    writable: primitiveValue(key === "prototype" || !isIntrinsic),
    enumerable: primitiveValue(!isIntrinsic),
    configurable: primitiveValue(key !== "prototype"),
  });
};

const getOwnPropertyDescriptors = (
  evaluator: BuiltinEvaluator,
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
        value: getFunctionOwnPropertyDescriptor(evaluator, target, key, context, location),
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
    if (name === "hasOwnProperty") return getFunctionOwnPresence(receiver, propertyName);
    if (
      receiver.kind === "function" &&
      receiver.hasStoredMetadata &&
      propertyName !== "prototype"
    ) {
      const descriptor = getOwnPropertyDescriptor(receiver.properties, propertyName);
      return descriptor === null
        ? unknownPrimitiveValue("boolean", "enumerability of a partially known function")
        : descriptor.kind === "object"
          ? getObjectProperty(descriptor, "enumerable")
          : FALSE_VALUE;
    }
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
export const getWitnessedPrototype = (
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
  evaluator: BuiltinEvaluator,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const separator = name.lastIndexOf(".");
  const invocation = name.slice(separator + 1);
  if (separator === -1 || !FUNCTION_INVOCATION_METHODS.has(invocation)) return null;
  const target = name.slice(0, separator);
  const intrinsic = getLanguageObject(target);
  if (intrinsic !== null && typeof intrinsic !== "function") return null;
  if (invocation === "apply")
    return callWithArgumentList(
      evaluator,
      args[1] ?? UNDEFINED_VALUE,
      context,
      location,
      true,
      (appliedArguments, appliedContext) =>
        callGlobal(
          evaluator,
          `${target}.call`,
          [args[0] ?? UNDEFINED_VALUE, ...appliedArguments],
          appliedContext,
          location,
          false,
        ),
    );
  if (target === "Object.prototype.toString") {
    const receiver = args[0] ?? UNDEFINED_VALUE;
    return invocation === "bind"
      ? nativeFunction(`bound ${target}`, (_args, tools) =>
          tools.call({ kind: "global", name: `${target}.call` }, [receiver]),
        )
      : getObjectTag(evaluator, receiver, context, location);
  }
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
  return evaluator.callValue(callee, args.slice(1), context, location);
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
  evaluator: BuiltinEvaluator,
  receiver: StaticGlobalValue,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const realm = evaluator.getRealm(context.environment);
  const listened = callEventTargetMethod(evaluator, realm, receiver, name, args, context, location);
  if (listened) return listened;
  if (realm.isGlobalAlias(receiver.name) && name === "matchMedia")
    return mediaQueryListValue(args[0]);
  const hotModuleResult = callHotModuleMethod(receiver, name);
  if (hotModuleResult) return hotModuleResult;
  if (isHistoryName(receiver.name))
    return callHistoryMethod(
      evaluator.history,
      evaluator.origin,
      name,
      args,
      location,
      (listener) => evaluator.markEscaped(listener),
    );
  if (isIndexedDbName(receiver.name))
    return callIndexedDbMethod(
      indexedDbHost(evaluator, context, location),
      evaluator.indexedDb,
      name,
      args,
    );
  if (isWebCryptoName(receiver.name))
    return callWebCryptoMethod(
      receiver.name,
      name,
      args,
      (list) => evaluator.recordHeapMutation(list),
      location,
    );
  const storageAreaName = getStorageAreaName(receiver.name);
  return storageAreaName === null
    ? null
    : callStorageMethod(
        evaluator.storageAreas[storageAreaName],
        storageAreaName,
        name,
        args,
        location,
      );
};

const convertToPrimitiveType = (
  name: "String" | "Number" | "Boolean",
  value: StaticValue | undefined,
  isConstructor: boolean,
): StaticValue => {
  if (name === "Number") return value ? toNumberValue(value) : primitiveValue(0);
  if (name === "Boolean") return value ? toBooleanValue(value) : FALSE_VALUE;
  return value
    ? mapValue(value, (alternative) =>
        !isConstructor && alternative.kind === "symbol"
          ? primitiveValue(`Symbol(${getSymbolDescription(alternative) ?? ""})`)
          : toStringOfValue(alternative),
      )
    : primitiveValue("");
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
  "JSON.parse",
]);

const getInvalidMapperError = (
  mapper: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  const nativeMapper =
    mapper.kind === "primitive" ? mapper.value : mapper.kind === "symbol" ? Symbol() : {};
  try {
    Reflect.apply(Array.from, Array, [[], nativeMapper]);
  } catch (error) {
    if (error instanceof TypeError) {
      return thrownValue(
        "non-callable array mapper",
        createErrorValue("TypeError", [primitiveValue(error.message)], location),
        location,
      );
    }
  }
  return unknownValue("array mapper validation", location);
};

const callGlobal = (
  evaluator: BuiltinEvaluator,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor: boolean,
): StaticValue => {
  if (isConstructor) {
    const constructionError = getIntrinsicConstructionError(name, location);
    if (constructionError) return constructionError;
  }
  const isArrayFrom =
    !isConstructor &&
    (name === "Array.from" ||
      (name.endsWith(".from") && isTypedArrayName(name.slice(0, -".from".length))));
  if (!isConstructor) {
    const invoked = callInvokedGlobal(evaluator, name, args, context, location);
    if (invoked) return invoked;
    const [receiver, memberName] = splitGlobalName(name);
    const hostResult =
      receiver.kind === "global"
        ? callHostObjectMethod(evaluator, receiver, memberName, args, context, location)
        : null;
    if (hostResult) return hostResult;
    const distributedArgumentCount = isArrayFrom
      ? 2
      : name === "Object.defineProperty"
        ? 3
        : name === "Object.defineProperties" || name === "Object.create"
          ? 2
          : name === "Object.fromEntries" || name === "Reflect.apply"
            ? 1
            : 0;
    if (distributedArgumentCount !== 0) {
      const branchIndex = args
        .slice(0, distributedArgumentCount)
        .findIndex((argument) => argument.kind === "branch");
      const branch = args[branchIndex];
      if (branch?.kind === "branch") {
        return evaluator.callAlternatives(branch, context, (alternative, alternativeContext) =>
          callGlobal(
            evaluator,
            name,
            args.with(branchIndex, alternative),
            alternativeContext,
            location,
            false,
          ),
        );
      }
    }
    const [inspected, ...rest] = args;
    if (inspected?.kind === "branch" && INSPECTING_GLOBALS.has(name)) {
      return mapValue(inspected, (alternative) =>
        callGlobal(evaluator, name, [alternative, ...rest], context, location, false),
      );
    }
  }
  if (isErrorConstructorName(name)) return createErrorValue(name, args, location);
  if (name === "import.meta.glob") return callImportMetaGlob(evaluator, args, context, location);
  if (name === "require.context") return callRequireContext(evaluator, args, context, location);
  if (isStringCodecName(name)) return callStringCodec(name, args, location);
  if (name === "Buffer.from") return createBufferValue(args, location);
  if (name === "Buffer.byteLength") return getBufferByteLength(args);
  const [first, second] = args;
  let hasMapper = isCallable(second);
  if (isArrayFrom && second) {
    const mapperType = getTypeofValue(second, evaluator.getRealm(context.environment));
    if (mapperType.kind !== "primitive")
      return unknownValue(`${name} with a dynamic mapper`, location);
    if (mapperType.value !== "undefined" && mapperType.value !== "function") {
      return getInvalidMapperError(second, location);
    }
    hasMapper = mapperType.value === "function";
  }
  if (isConstructor && (isTypedArrayName(name) || name === "ArrayBuffer"))
    return constructBinary(name, args, location);
  if (name === "ArrayBuffer.isView") {
    const isView = isBinaryView(first);
    return isView === null
      ? unknownPrimitiveValue("boolean", "ArrayBuffer.isView on dynamic value")
      : primitiveValue(isView);
  }
  if (!isConstructor && name === "Array.of") return listValue([...args]);
  if (name.endsWith(".of")) {
    const constructorName = name.slice(0, -".of".length);
    if (isTypedArrayName(constructorName))
      return convertTypedElements(constructorName, args, location, `${name}()`);
  }
  if (name === "Intl.NumberFormat") return createNumberFormat(args, location);
  if (isConstructor && name === "TextEncoder") return createTextEncoder();
  if (isConstructor && name === "TextDecoder") return createTextDecoder(first, location);
  if (isConstructor && isDomObserverName(name))
    return createDomObserver(evaluator, name, first, location);
  if (isConstructor && isNativeConstructorName(name) && (name !== "Date" || args.length > 0)) {
    const constructed = constructNativeObject(name, args);
    if (constructed) return constructed;
  }
  if (isConstructor && isHostNodeConstructorName(name) && evaluator.hostDocument) {
    const node = constructHostNode(evaluator.hostDocument, name, args);
    if (node) return node;
  }
  switch (name) {
    case "Date": {
      if (!isConstructor) break;
      if (args.length === 0) return createClockDateValue(evaluator.timers.readClock("new Date"));
      if (args.length !== 1 || first === undefined) break;
      if (isClockReading(first)) return createClockDateValue(first);
      const copy = cloneDateValue(first);
      if (copy) return copy;
      if (first.kind === "unknown-primitive" && first.primitiveType === "number")
        return createUnknownDateValue(first);
      break;
    }
    case "Function":
      return constructFunctionFromSource(evaluator, args, location);
    case "Object":
      return first ? toObjectValue(first, location) : objectValue([]);
    case "String":
    case "Number":
    case "Boolean": {
      const converted = convertToPrimitiveType(name, first, isConstructor);
      return isConstructor ? toObjectValue(converted, location) : converted;
    }
    case "Array":
      return args.length === 1 && first !== undefined
        ? arrayOfLength(first, location)
        : listValue(args);
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet": {
      const initial = first && evaluator.resolveIterable(first, context, location);
      return initial?.kind === "branch"
        ? evaluator.callAlternatives(initial, context, (alternative) =>
            createCollectionValue(name, alternative, location),
          )
        : createCollectionValue(name, initial, location);
    }
    case "URLSearchParams":
      return mapValue(distributeObjectBranches(first ?? UNDEFINED_VALUE), (init) =>
        createSearchParamsValue(init, { location }),
      );
    case "URL":
      return createUrlValue(args, location);
    case "AbortController":
      if (isConstructor) return createAbortController(evaluator, location);
      break;
    case "AudioContext":
    case "webkitAudioContext":
      if (isConstructor) return createAudioContext(first);
      break;
    case "AudioWorkletNode":
      if (isConstructor) return createAudioWorkletNode();
      break;
    case "Image":
      if (isConstructor)
        return createImageElement(imageLoadHost(evaluator, context, location), args);
      break;
    case "fetch":
      if (isConstructor) break;
      return callFetch(evaluator.project, args, location);
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
      return createPromiseValue(first, promiseTools(evaluator, context, location), location);
    case "Symbol":
      return mapValue(first ?? UNDEFINED_VALUE, (description) =>
        description.kind === "primitive"
          ? createSymbolValue(
              description.value === undefined ? undefined : String(description.value),
            )
          : unknownValue("Symbol with a dynamic description", location),
      );
    case "Symbol.for":
      return mapValue(first ?? UNDEFINED_VALUE, (key) =>
        key.kind === "primitive" && typeof key.value === "string"
          ? createRegisteredSymbolValue(key.value)
          : unknownValue("Symbol.for with a dynamic key", location),
      );
    case "Promise.resolve":
      return resolvedPromiseValue(first ?? UNDEFINED_VALUE);
    case "Promise.reject":
      return resolvedPromiseValue(
        thrownValue("rejected promise", first ?? UNDEFINED_VALUE, location),
      );
    case "Promise.all":
      return first?.kind === "list"
        ? combinePromises(first.items, promiseTools(evaluator, context, location), location)
        : unknownValue("Promise.all", location);
    case "Array.isArray": {
      const verdict = first ? isArrayValue(first) : false;
      return verdict === null
        ? unknownPrimitiveValue("boolean", "Array.isArray on dynamic value")
        : primitiveValue(verdict);
    }
    case "Array.from":
    case "Int8Array.from":
    case "Uint8Array.from":
    case "Uint8ClampedArray.from":
    case "Int16Array.from":
    case "Uint16Array.from":
    case "Int32Array.from":
    case "Uint32Array.from":
    case "Float32Array.from":
    case "Float64Array.from":
      return callArrayFrom(
        evaluator,
        name.slice(0, -".from".length),
        first ?? UNDEFINED_VALUE,
        hasMapper ? second : undefined,
        args[2] ?? UNDEFINED_VALUE,
        context,
        location,
      );
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
      const target = evaluator.materializeNamespace(first ?? UNDEFINED_VALUE, context.environment);
      return evaluator.continueValue(target, context, (alternative, alternativeContext) => {
        if (
          alternative.kind === "object" &&
          (alternative.entries.some((entry) => entry.kind === "spread" || entry.accessor) ||
            !getKnownObjectKeys(alternative))
        ) {
          const enumerated = enumerateOwnObject(
            evaluator,
            alternative,
            name,
            alternativeContext,
            location,
          );
          if (enumerated) return enumerated;
        }
        if (alternative.kind === "list") {
          if (!alternative.items.some(isIndefiniteItem)) return inspect(alternative);
          const inspected = mapFiniteListItems(alternative.items, (items) =>
            inspect({ ...alternative, items }),
          );
          if (inspected) return inspected;
        }
        return getOwnEnumerableEntries(alternative)
          ? inspect(alternative)
          : mapValue(distributeObjectBranches(alternative), inspect);
      });
    }
    case "Object.assign":
      return evaluator.continueValue(first ?? UNDEFINED_VALUE, context, (target, targetContext) => {
        if (isNullish(target) === true)
          return thrownValue(
            "Object.assign requires a target",
            createErrorValue(
              "TypeError",
              [primitiveValue("Cannot convert undefined or null to object")],
              location,
            ),
            location,
          );
        if (
          target.kind !== "object" &&
          target.kind !== "function" &&
          target.kind !== "class" &&
          target.kind !== "component-reference" &&
          target.kind !== "proxy"
        )
          return target.kind === "unknown"
            ? objectValue(args.map((argument) => ({ kind: "spread", value: argument })))
            : target;
        let result: StaticValue = target;
        for (const source of args.slice(1)) {
          result = evaluator.continueValue(result, targetContext, (receiver, receiverContext) =>
            evaluator.continueValue(source, receiverContext, (selected, sourceContext) => {
              const materialized = evaluator.materializeNamespace(
                selected,
                sourceContext.environment,
              );
              const object =
                materialized.kind === "primitive" && typeof materialized.value === "string"
                  ? objectValue(
                      materialized.value.split("").map((character, index) => ({
                        kind: "property",
                        key: String(index),
                        value: primitiveValue(character),
                      })),
                    )
                  : materialized;
              if (object.kind === "primitive" || object.kind === "symbol") return receiver;
              if (object.kind === "object") {
                const assigned = assignObjectSource(
                  evaluator,
                  receiver,
                  object,
                  sourceContext,
                  location,
                );
                if (assigned) return assigned;
              }
              if (receiver.kind === "object") {
                evaluator.recordHeapMutation(receiver);
                assignOwnEntries(receiver, object);
              }
              return receiver;
            }),
          );
        }
        return result;
      });
    case "Object.freeze":
    case "Object.seal":
    case "Object.preventExtensions":
      return evaluator.continueValue(first ?? UNDEFINED_VALUE, context, (target) => {
        if (target.kind === "object") {
          const integrity = getNextObjectIntegrity(target, name);
          if (!target.integrity || !isSameValue(integrity, target.integrity)) {
            evaluator.recordHeapMutation(target);
            target.integrity = integrity;
          }
        } else if (target.kind === "list" && name === "Object.freeze") target.isFrozen = true;
        return target;
      });
    case "Object.is": {
      const left = first ?? UNDEFINED_VALUE;
      const right = second ?? UNDEFINED_VALUE;
      return (
        distributeBinary(left, right, getSameValueComparison) ?? getSameValueComparison(left, right)
      );
    }
    case "Object.isFrozen":
    case "Object.isSealed":
    case "Object.isExtensible":
      return mapValue(first ?? UNDEFINED_VALUE, (target) => {
        if (target.kind === "object")
          return name === "Object.isExtensible"
            ? getObjectExtensibility(target)
            : getObjectIntegrityTest(target, name === "Object.isFrozen");
        if (target.kind === "primitive" || target.kind === "symbol")
          return primitiveValue(name !== "Object.isExtensible");
        if (target.kind === "list" && name === "Object.isFrozen")
          return primitiveValue(target.isFrozen === true);
        return unknownPrimitiveValue("boolean", `${name} on a dynamic target`);
      });
    case "Object.setPrototypeOf":
      return first ?? UNDEFINED_VALUE;
    case "Object.getPrototypeOf":
    case "Reflect.getPrototypeOf":
      if (first?.kind === "class") return getClassPrototype(first);
      if (first?.kind === "function") return { kind: "global", name: "Function.prototype" };
      if (first?.kind === "object" && first.prototype) return first.prototype;
      if (first?.kind === "object" && first.hasNullPrototype) return NULL_VALUE;
      if (first?.kind === "object" && first.constructedBy)
        return getClassPrototypeObject(evaluator, first.constructedBy, context);
      if (first?.kind === "object" && (isBaseClassPrototype(first) || !isClassPrototype(first)))
        return { kind: "global", name: "Object.prototype" };
      return getWitnessedPrototype(first, name, location);
    case "Object.getOwnPropertyNames":
    case "Object.getOwnPropertySymbols":
    case "Reflect.ownKeys":
      return evaluator.continueValue(first ?? UNDEFINED_VALUE, context, (target, targetContext) => {
        if (target.kind === "function") {
          const names = name === "Object.getOwnPropertySymbols" ? [] : getFunctionOwnNames(target);
          return names
            ? listValue(names.map((key) => primitiveValue(key)))
            : unknownValue(`${name} on a partially known function`, location);
        }
        if (target.kind !== "object" && target.kind !== "list")
          return unknownValue(`${name} on a dynamic target`, location);
        if (target.kind === "object") {
          const enumerated = enumerateOwnObject(evaluator, target, name, targetContext, location);
          if (enumerated) return enumerated;
        }
        const ownNames = name === "Object.getOwnPropertySymbols" ? [] : getOwnNames(target);
        const ownSymbols =
          name === "Object.getOwnPropertyNames" || target.kind === "list"
            ? []
            : getKnownObjectSymbols(target);
        return ownNames && ownSymbols
          ? listValue([...ownNames.map((key) => primitiveValue(key)), ...ownSymbols])
          : unknownValue(`${name} on an object with dynamic spreads`, location);
      });
    case "Object.getOwnPropertyDescriptor": {
      const key = second ? toPropertyKey(second) : null;
      if (first?.kind === "element" && key === "ref")
        return getElementRefDescriptor(first, location);
      if (first?.kind === "function" && key !== null)
        return getFunctionOwnPropertyDescriptor(evaluator, first, key, context, location);
      if (first?.kind !== "object" || key === null)
        return unknownValue(`${name} on a dynamic target`, location);
      return (
        getOwnPropertyDescriptor(first, key) ??
        unknownValue(`${name} on an object with dynamic spreads`, location)
      );
    }
    case "Object.create": {
      if (!first) break;
      return evaluator.continueValue(first, context, (prototype, prototypeContext) => {
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
        return second && !isUndefinedValue(second)
          ? defineOwnProperties(evaluator, created, second, prototypeContext, location)
          : created;
      });
    }
    case "Reflect.get":
      return first && second?.kind === "primitive"
        ? evaluator.getProperty(first, String(second.value), context, location)
        : unknownValue("Reflect.get with a dynamic key", location);
    case "Reflect.has":
      return first && second
        ? evaluator.getHasProperty(first, second, context, location)
        : unknownValue("Reflect.has on a dynamic target", location);
    case "Reflect.apply": {
      const target = first ?? UNDEFINED_VALUE;
      const targetType = getTypeofValue(target, evaluator.getRealm(context.environment));
      if (targetType.kind !== "primitive" || targetType.value !== "function")
        return unknownValue("Reflect.apply with non-callable or dynamic target", location);
      return callWithArgumentList(
        evaluator,
        args[2] ?? UNDEFINED_VALUE,
        context,
        location,
        false,
        (appliedArguments, appliedContext) =>
          evaluator.callValue(target, appliedArguments, appliedContext, location, {
            thisValue: second ?? null,
          }),
      );
    }
    case "Reflect.construct":
      return reflectConstruct(evaluator, args, context, location);
    case "Object.defineProperty": {
      const descriptor = args[2];
      const key = second ? getPropertyName(second) : null;
      if (!first || key === null || !descriptor) {
        return first ?? unknownValue("Object.defineProperty on a dynamic target", location);
      }
      return evaluator.continueValue(
        readPropertyDescriptor(evaluator, descriptor, context, location),
        context,
        (normalized, descriptorContext) =>
          defineOwnProperty(evaluator, first, key, normalized, descriptorContext, location),
      );
    }
    case "Object.getOwnPropertyDescriptors":
      return first
        ? getOwnPropertyDescriptors(evaluator, first, context, location)
        : unknownValue(`${name} without a target`, location);
    case "Object.defineProperties": {
      if (!first || !second)
        return unknownValue("Object.defineProperties without arguments", location);
      return defineOwnProperties(evaluator, first, second, context, location);
    }
    case "Object.fromEntries": {
      const entries = first && evaluator.resolveIterable(first, context, location);
      return mapValue(entries ?? UNDEFINED_VALUE, (alternative) =>
        alternative.kind === "list" && !alternative.items.some((item) => item.kind === "repeat")
          ? {
              ...objectValue(
                alternative.items.map(
                  (pair) =>
                    getEntryFromPair(pair) ?? {
                      kind: "spread",
                      preservesDescriptors: true,
                      value: unknownValue("dynamic entry"),
                    },
                ),
              ),
              hasObjectPrototype: true,
            }
          : unknownValue("Object.fromEntries of dynamic entries", location),
      );
    }
    case "Object.groupBy":
    case "Map.groupBy":
      return first && isCallable(second)
        ? groupItems(evaluator, name, first, second, context, location)
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
      if (isFiniteUnknownNumber(number)) return name === "isNaN" ? FALSE_VALUE : TRUE_VALUE;
      return unknownPrimitiveValue("boolean", name);
    }
    case "Number.isNaN":
    case "Number.isFinite":
    case "Number.isInteger":
    case "Number.isSafeInteger": {
      if (first === undefined) return FALSE_VALUE;
      if (first.kind === "primitive") return primitiveValue(NUMBER_PREDICATES[name](first.value));
      const typeofFirst = getTypeofValue(first, evaluator.getRealm(context.environment));
      if (typeofFirst.kind === "primitive" && typeofFirst.value !== "number") return FALSE_VALUE;
      if (isFiniteUnknownNumber(first)) {
        if (name === "Number.isNaN") return FALSE_VALUE;
        if (name === "Number.isFinite") return TRUE_VALUE;
      }
      return unknownPrimitiveValue("boolean", name);
    }
    case "JSON.stringify": {
      if (!first || args.length !== 1) return unknownPrimitiveValue("string", "JSON.stringify");
      return stringifyJsonValue(first, location);
    }
    case "JSON.parse": {
      const text = first ?? UNDEFINED_VALUE;
      if (second === undefined || (second.kind === "primitive" && second.value === undefined)) {
        const parsed = parseSerializedJson(text);
        if (parsed !== null) return parsed;
      }
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
        const handle = evaluator.timers.createHandle("queueMicrotask");
        evaluator.timers.queueMicrotask(
          scheduledTask(evaluator, first, context, location, handle),
          handle,
        );
      }
      return UNDEFINED_VALUE;
    case "setTimeout":
    case "setImmediate":
    case "requestAnimationFrame":
    case "requestIdleCallback": {
      const handle = evaluator.timers.createHandle(name);
      if (first) {
        if (name === "requestAnimationFrame" && evaluator.timers.isRunningAnimationFrame) {
          evaluator.markEscaped(first);
          return handle;
        }
        const delayMs =
          name === "requestAnimationFrame" ? 16 : evaluator.timers.getSettledDelay(second);
        if (delayMs === null) evaluator.markEscaped(first);
        else {
          const task = scheduledTask(
            evaluator,
            first,
            context,
            location,
            handle,
            name === "setTimeout" ? args.slice(2) : [],
          );
          evaluator.timers.schedule(
            handle,
            name === "requestAnimationFrame"
              ? () => evaluator.timers.runAnimationFrame(task)
              : task,
            delayMs,
          );
        }
      }
      return handle;
    }
    case "setInterval": {
      const handle = evaluator.timers.createHandle(name);
      if (first) {
        const delayMs = evaluator.timers.getSettledDelay(second);
        const isDeferred = evaluator.timers.isDeferred;
        if (delayMs === null) evaluator.markEscaped(first);
        else {
          evaluator.timers.schedule(
            handle,
            () =>
              evaluator.runIntervalTicks(
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
        return evaluator.callAlternatives(first, context, (alternative, alternativeContext) =>
          callGlobal(
            evaluator,
            name,
            [alternative, ...args.slice(1)],
            alternativeContext,
            location,
            false,
          ),
        );
      }
      evaluator.timers.clear(first);
      return UNDEFINED_VALUE;
    case "Date.now":
    case "performance.now":
      return evaluator.timers.readClock(name);
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
        callGlobal(evaluator, name, args.with(branchIndex, alternative), context, location, false),
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
  if (isConstructor) {
    return (
      constructDeclaredHostObject(evaluator.getRealm(context.environment), name, location) ??
      unknownValue(`new ${name}()`, location)
    );
  }
  return unknownValue(`${name}()`, location);
};

/** A task queued from a continuation of unknown timing runs at an unknown time too. */
const scheduledTask = (
  evaluator: BuiltinEvaluator,
  callback: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
  handle: StaticValue,
  callbackArguments: StaticValue[] = [],
): (() => void) => {
  const task = evaluator.timers.isDeferred
    ? () => evaluator.callDeferred(callback, callbackArguments, context, location)
    : () => evaluator.callValue(callback, callbackArguments, context, location);
  return () => evaluator.runTimerTask(handle, context, location, task);
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
  evaluator: BuiltinEvaluator,
  description: string,
): ((task: () => void) => void) => {
  const isDeferred = evaluator.timers.isDeferred;
  return (task) =>
    evaluator.timers.schedule(
      evaluator.timers.createHandle(description),
      isDeferred ? () => evaluator.timers.runDeferred(task) : task,
    );
};

const indexedDbHost = (
  evaluator: BuiltinEvaluator,
  context: EvaluationContext,
  location: SourceLocation | null,
): IndexedDbHost => ({
  schedule: scheduleTask(evaluator, "IndexedDB request"),
  call: (callee, callArgs) => evaluator.callValue(callee, callArgs, context, location),
  setProperty: (object, key, value) => evaluator.assignOwnProperty(object, key, value),
  location,
});

const imageLoadHost = (
  evaluator: BuiltinEvaluator,
  context: EvaluationContext,
  location: SourceLocation | null,
): ImageLoadHost => ({
  schedule: scheduleTask(evaluator, "image load"),
  queueMicrotask: (task) => evaluator.timers.queueMicrotask(task),
  call: (callee, callArgs) => evaluator.callValue(callee, callArgs, context, location),
  setProperty: (object, key, value, accessor) =>
    evaluator.assignOwnProperty(object, key, value, accessor),
  markEscaped: (value) => evaluator.markEscaped(value),
  readServedAsset: (url) => evaluator.project.readServedAsset(url),
});

export const promiseTools = (
  evaluator: BuiltinEvaluator,
  context: EvaluationContext,
  location: SourceLocation | null,
): PromiseTools => ({
  call: (callee, callArgs) => evaluator.callValue(callee, callArgs, context, location),
  callDeferred: (callee, callArgs) => evaluator.callDeferred(callee, callArgs, context, location),
  markEscaped: (value) => evaluator.markEscaped(value),
  queueMicrotask: (task) => evaluator.queueMicrotask(task, context, location),
  bindTask: (task) => evaluator.bindTask(task, context, location),
  runTask: (cause, task) => evaluator.runTaskWithCause(cause, task, context, location),
  runTaskAlternatives: (causes, task, reason) =>
    evaluator.runTaskAlternatives(causes, task, reason, context, location),
  recordStateMutation: (state) => evaluator.recordStateMutation(state),
});

/**
 * `then`/`catch`/`finally`. Handlers on a modeled promise run as microtasks
 * once it settles; on a value the analysis cannot follow they are
 * continuations that land after the captured commit; any other receiver is
 * treated as an already-fulfilled thenable.
 */
const callPromiseMethod = (
  evaluator: BuiltinEvaluator,
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
    return chainPromise(modeled, handlers, promiseTools(evaluator, context, location), location);
  }
  if (receiver.kind === "unknown" || receiver.kind === "external") {
    if (handlers.onFulfilled)
      return evaluator.callDeferred(handlers.onFulfilled, [receiver], context, location);
    for (const handler of [handlers.onRejected, handlers.onFinally]) {
      if (handler) evaluator.markEscaped(handler);
    }
    return receiver;
  }
  if (handlers.onFulfilled)
    return evaluator.callValue(handlers.onFulfilled, [receiver], context, location);
  if (handlers.onFinally) {
    const result = evaluator.callValue(handlers.onFinally, [], context, location);
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
  evaluator: BuiltinEvaluator,
  callee: Extract<StaticValue, { kind: "method" | "global" }>,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor = false,
): StaticValue => {
  if (callee.kind === "global")
    return callGlobal(evaluator, callee.name, args, context, location, isConstructor);
  const { receiver, name } = callee;
  const boundArguments = bindCallbackThisArg(name, args);
  const [first, second] = boundArguments;

  if (isPromiseMethodName(name))
    return callPromiseMethod(evaluator, receiver, name, args, context, location);

  if (name === "toString" && args.length === 0) {
    const sourceText = getFunctionText(receiver);
    if (sourceText !== null) return sourceText;
  }

  if ((name === "hasOwnProperty" || name === "propertyIsEnumerable") && first !== undefined) {
    const ownProperty = hasOwnProperty(receiver, first, name);
    if (ownProperty) return ownProperty;
  }

  if (receiver.kind === "function") {
    if (name === "bind") return bindFunction(evaluator, receiver, args, context, location);
    if (name === "call")
      return evaluator.callFunction(receiver, args.slice(1), context, {
        thisValue: first ?? null,
      });
    if (name === "apply") {
      return callWithArgumentList(
        evaluator,
        second ?? UNDEFINED_VALUE,
        context,
        location,
        true,
        (appliedArguments, appliedContext) =>
          evaluator.callFunction(receiver, appliedArguments, appliedContext, {
            thisValue: first ?? null,
          }),
      );
    }
    return unknownValue(`function.${name}()`, location);
  }

  if (receiver.kind === "object") {
    if (name === "valueOf") return receiver;
    if (name === "toString")
      return getErrorWitness(receiver)
        ? getErrorText(
            evaluator.getProperty(receiver, "name", context, location),
            evaluator.getProperty(receiver, "message", context, location),
          )
        : getObjectTag(evaluator, receiver, context, location);
  }

  if (name === "isPrototypeOf" && first !== undefined) {
    const isOnChain = isPrototypeOf(receiver, first);
    if (isOnChain !== null) return primitiveValue(isOnChain);
  }

  if (receiver.kind === "global")
    return callGlobal(evaluator, `${receiver.name}.${name}`, args, context, location, false);

  const listened = callEventTargetMethod(
    evaluator,
    evaluator.getRealm(context.environment),
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
    if (name === "call") return evaluator.callValue(rebound, args.slice(1), context, location);
    if (name === "apply") {
      return callWithArgumentList(
        evaluator,
        second ?? UNDEFINED_VALUE,
        context,
        location,
        true,
        (appliedArguments, appliedContext) =>
          evaluator.callValue(rebound, appliedArguments, appliedContext, location),
      );
    }
    if (name === "bind") {
      const boundArgs = args.slice(1);
      if (rebound.kind !== "method" && boundArgs.length === 0) return rebound;
      const boundThis = rebound.kind === "method" ? undefined : first;
      const boundName = rebound.kind === "react-api" ? rebound.api : rebound.name;
      return nativeFunction(`bound ${boundName}`, (callArgs, tools) =>
        tools.call(rebound, [...boundArgs, ...callArgs], boundThis),
      );
    }
  }

  if (receiver.kind === "primitive") {
    const branchIndex = args.findIndex(isPrimitiveBranch);
    const argument = args[branchIndex];
    if (
      argument?.kind === "branch" &&
      args.filter((value) => value.kind === "branch").length === 1
    ) {
      return evaluator.callAlternatives(argument, context, (alternative, branchContext) =>
        evaluateBuiltinCall(
          evaluator,
          callee,
          args.with(branchIndex, alternative),
          branchContext,
          location,
          isConstructor,
        ),
      );
    }
    const computed =
      typeof receiver.value === "string"
        ? callStringMethod(evaluator, receiver.value, name, args, context)
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
    evaluator,
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
