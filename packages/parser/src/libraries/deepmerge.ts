import { hasNamedProperty } from "../evaluate/has-property.js";
import type { MutableHeapValue } from "../evaluate/heap-journal.js";
import {
  decidedBooleanValue,
  getKnownEnumerableOwnKeys,
  getObjectProperty,
  getTruthiness,
  hasDefiniteItems,
  listValue,
  objectValue,
  primitiveValue,
  unknownValue,
  isCallable,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type {
  LibraryValueProvider,
  StaticNativeFunctionValue,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { getContainerKeys, isContainer, isDecided, readMember } from "./merge-containers.js";

// Mirrors deepmerge's `deepmerge(target, source, options)`: a fresh
// destination receives clones of the target's own enumerable members, then each
// source member either merges into the target's value of the same key (when the
// key is on the target and the source value is mergeable), or is cloned in.
// Arrays go through `options.arrayMerge` (concatenation by default), `customMerge(key)`
// may swap the per-key merge function, `isMergeableObject` may be replaced, and
// `clone: false` keeps references. The options object is mutated with the resolved
// `arrayMerge`, `isMergeableObject` and `cloneUnlessOtherwiseSpecified`, which custom
// array mergers read back. Anything the analysis cannot decide leaves the whole
// merge unknown.

export const DEEPMERGE_PACKAGES = ["deepmerge"];

interface MergeOptions {
  object: StaticObjectValue;
  arrayMerge: StaticValue;
  isMergeableObject: StaticValue;
  customMerge: StaticValue | null;
  isClone: boolean;
}

/** deepmerge's `isMergeableObject`: a non-null object that is not a RegExp, Date or React element. */
const decideMergeable = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "object":
    case "list":
      return true;
    case "regexp":
    case "element":
    case "primitive":
    case "function":
    case "native-function":
    case "class":
    case "symbol":
    case "method":
    case "component-reference":
      return false;
    case "unknown-primitive":
      return value.primitiveType === "any" ? null : false;
    case "native-object":
      return value.value instanceof Date || value.value instanceof RegExp ? false : null;
    default:
      return null;
  }
};

const decideArray = (value: StaticValue): boolean | null =>
  value.kind === "list" ? true : isDecided(value) ? false : null;

const getKeys = (container: MutableHeapValue): string[] | null =>
  container.kind === "object" ? getKnownEnumerableOwnKeys(container) : getContainerKeys(container);

/** `key in target`; `in` on a primitive throws, which deepmerge reads as false. */
const decidePropertyIsOnObject = (target: StaticValue, key: string): boolean | null => {
  if (target.kind === "primitive") return false;
  const verdict = hasNamedProperty(key, target);
  return verdict?.kind === "primitive" && typeof verdict.value === "boolean" ? verdict.value : null;
};

const decideOwnEnumerable = (target: StaticValue, key: string): boolean | null => {
  if (!isContainer(target)) return null;
  return getKeys(target)?.includes(key) ?? null;
};

class StaticDeepMerger {
  private readonly visiting = new Set<StaticValue>();

  constructor(private readonly tools: StubRenderTools) {}

  /** `options || {}` with the defaults the library writes onto it; null when a field is undecided. */
  resolveOptions(optionsValue: StaticValue | undefined): MergeOptions | null {
    let object: StaticObjectValue;
    if (optionsValue === undefined || (optionsValue.kind === "primitive" && !optionsValue.value)) {
      object = objectValue();
    } else if (optionsValue.kind === "object") {
      object = optionsValue;
    } else {
      return null;
    }
    const arrayMerge = this.defaultOption(object, "arrayMerge", defaultArrayMerge);
    const mergeabilityTest = this.defaultOption(object, "isMergeableObject", isMergeableObject);
    if (arrayMerge === null || mergeabilityTest === null) return null;
    if (
      getObjectProperty(object, "cloneUnlessOtherwiseSpecified") !== cloneUnlessOtherwiseSpecified
    ) {
      this.tools.setProperty(
        object,
        "cloneUnlessOtherwiseSpecified",
        cloneUnlessOtherwiseSpecified,
      );
    }
    const clone = getObjectProperty(object, "clone");
    const isClone = clone.kind === "primitive" ? clone.value !== false : isDecided(clone) || null;
    const customMerge = getObjectProperty(object, "customMerge");
    const hasCustomMerge = getTruthiness(customMerge);
    if (isClone === null || hasCustomMerge === null) return null;
    if (hasCustomMerge && !isCallable(customMerge)) return null;
    return {
      object,
      arrayMerge,
      isMergeableObject: mergeabilityTest,
      customMerge: hasCustomMerge ? customMerge : null,
      isClone,
    };
  }

  /** `options[key] = options[key] || fallback`. */
  private defaultOption(
    object: StaticObjectValue,
    key: string,
    fallback: StaticValue,
  ): StaticValue | null {
    const current = getObjectProperty(object, key);
    const isSet = getTruthiness(current);
    if (isSet === null) return null;
    if (isSet) return isCallable(current) ? current : null;
    this.tools.setProperty(object, key, fallback);
    return fallback;
  }

  isMergeable(value: StaticValue, options: MergeOptions): boolean | null {
    if (options.isMergeableObject === isMergeableObject) return decideMergeable(value);
    return getTruthiness(this.tools.call(options.isMergeableObject, [value]));
  }

  clone(value: StaticValue, options: MergeOptions): StaticValue | null {
    if (!options.isClone) return value;
    const isMergeable = this.isMergeable(value, options);
    if (isMergeable === null) return null;
    if (!isMergeable) return value;
    return this.merge(value.kind === "list" ? listValue([]) : objectValue(), value, options);
  }

  merge(target: StaticValue, source: StaticValue, options: MergeOptions): StaticValue | null {
    const sourceIsArray = decideArray(source);
    const targetIsArray = decideArray(target);
    if (sourceIsArray === null || targetIsArray === null) return null;
    if (sourceIsArray !== targetIsArray) return this.clone(source, options);
    if (sourceIsArray) {
      if (options.arrayMerge === defaultArrayMerge)
        return this.mergeArrays(target, source, options);
      return this.tools.call(options.arrayMerge, [target, source, options.object]);
    }
    return this.mergeObjects(target, source, options);
  }

  mergeArrays(target: StaticValue, source: StaticValue, options: MergeOptions): StaticValue | null {
    if (target.kind !== "list" || source.kind !== "list") return null;
    if (!hasDefiniteItems(target) || !hasDefiniteItems(source)) return null;
    const items: StaticValue[] = [];
    for (const item of [...target.items, ...source.items]) {
      const cloned = this.clone(item, options);
      if (cloned === null) return null;
      items.push(cloned);
    }
    return listValue(items);
  }

  private mergeObjects(
    target: StaticValue,
    source: StaticValue,
    options: MergeOptions,
  ): StaticValue | null {
    if (!isContainer(source) || this.visiting.has(source)) return null;
    const sourceKeys = getKeys(source);
    if (sourceKeys === null) return null;
    this.visiting.add(source);
    try {
      const destination = objectValue();
      if (!this.copyTarget(destination, target, options)) return null;
      for (const key of sourceKeys) {
        const isUnsafe = this.decideUnsafe(target, key);
        if (isUnsafe === null) return null;
        if (isUnsafe) continue;
        const merged = this.mergeKey(target, source, key, options);
        if (merged === null) return null;
        this.tools.setProperty(destination, key, merged);
      }
      return destination;
    } finally {
      this.visiting.delete(source);
    }
  }

  private copyTarget(
    destination: StaticObjectValue,
    target: StaticValue,
    options: MergeOptions,
  ): boolean {
    const isMergeable = this.isMergeable(target, options);
    if (isMergeable === null) return false;
    if (!isMergeable) return true;
    if (!isContainer(target)) return false;
    const keys = getKeys(target);
    if (keys === null) return false;
    for (const key of keys) {
      const value = readMember(target, key);
      const cloned = value === null ? null : this.clone(value, options);
      if (cloned === null) return false;
      this.tools.setProperty(destination, key, cloned);
    }
    return true;
  }

  /** deepmerge's `propertyIsUnsafe`: on the target but inherited or non-enumerable. */
  private decideUnsafe(target: StaticValue, key: string): boolean | null {
    const isOnObject = decidePropertyIsOnObject(target, key);
    if (isOnObject !== true) return isOnObject;
    const isOwnEnumerable = decideOwnEnumerable(target, key);
    return isOwnEnumerable === null ? null : !isOwnEnumerable;
  }

  private mergeKey(
    target: StaticValue,
    source: MutableHeapValue,
    key: string,
    options: MergeOptions,
  ): StaticValue | null {
    const sourceValue = readMember(source, key);
    if (sourceValue === null) return null;
    const isOnObject = decidePropertyIsOnObject(target, key);
    const isMergeable = isOnObject ? this.isMergeable(sourceValue, options) : false;
    if (isOnObject === null || isMergeable === null) return null;
    if (!isOnObject || !isMergeable) return this.clone(sourceValue, options);
    if (!isContainer(target)) return null;
    const targetValue = readMember(target, key);
    if (targetValue === null) return null;
    const mergeFunction = this.getMergeFunction(key, options);
    if (mergeFunction === null) return null;
    if (mergeFunction === undefined) return this.merge(targetValue, sourceValue, options);
    return this.tools.call(mergeFunction, [targetValue, sourceValue, options.object]);
  }

  /** `customMerge(key)` when it yields a function; undefined for deepmerge itself; null when undecided. */
  private getMergeFunction(key: string, options: MergeOptions): StaticValue | null | undefined {
    if (options.customMerge === null) return undefined;
    const custom = this.tools.call(options.customMerge, [primitiveValue(key)]);
    if (isCallable(custom)) return custom;
    return isDecided(custom) ? undefined : null;
  }
}

const undecided = (name: string): StaticValue =>
  unknownValue(`deepmerge ${name} of a partially known value`);

const withOptions = (
  name: string,
  optionsValue: StaticValue | undefined,
  tools: StubRenderTools,
  run: (merger: StaticDeepMerger, options: MergeOptions) => StaticValue | null,
): StaticValue => {
  const merger = new StaticDeepMerger(tools);
  const options = merger.resolveOptions(optionsValue);
  return (options && run(merger, options)) ?? undecided(name);
};

const isMergeableObject = nativeFunction("isMergeableObject", ([value]) =>
  decidedBooleanValue(
    value === undefined ? false : decideMergeable(value),
    "deepmerge isMergeableObject of a partially known value",
  ),
);

const cloneUnlessOtherwiseSpecified = nativeFunction(
  "cloneUnlessOtherwiseSpecified",
  ([value, optionsValue], tools) =>
    withOptions("cloneUnlessOtherwiseSpecified", optionsValue, tools, (merger, options) =>
      value === undefined ? null : merger.clone(value, options),
    ),
);

const defaultArrayMerge = nativeFunction(
  "defaultArrayMerge",
  ([target, source, optionsValue], tools) =>
    withOptions("arrayMerge", optionsValue, tools, (merger, options) =>
      target === undefined || source === undefined
        ? null
        : merger.mergeArrays(target, source, options),
    ),
);

const mergeCall = (
  target: StaticValue,
  source: StaticValue,
  optionsValue: StaticValue | undefined,
  tools: StubRenderTools,
): StaticValue =>
  withOptions("merge", optionsValue, tools, (merger, options) =>
    merger.merge(target, source, options),
  );

const deepmergeAll = nativeFunction("deepmerge.all", ([array, optionsValue], tools) => {
  if (array?.kind !== "list" || !hasDefiniteItems(array)) return undecided("all");
  let merged: StaticValue = objectValue();
  for (const item of array.items) merged = mergeCall(merged, item, optionsValue, tools);
  return merged;
});

const deepmerge: StaticNativeFunctionValue = {
  kind: "native-function",
  name: "deepmerge",
  call: ([target, source, optionsValue], tools) =>
    target === undefined || source === undefined
      ? undecided("merge")
      : mergeCall(target, source, optionsValue, tools),
  getOwnProperty: (key) => (key === "all" ? deepmergeAll : undefined),
};

export const deepmergeValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === "deepmerge" && importedName === "default" ? deepmerge : null;
