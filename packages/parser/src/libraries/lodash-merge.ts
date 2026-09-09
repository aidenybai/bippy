import {
  getKnownObjectKeys,
  getObjectAccessor,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  objectValue,
  primitiveValue,
  toIndexKey,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type {
  StaticListValue,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// Mirrors lodash's `baseMerge`/`baseMergeDeep`: a plain-object or array source
// merges recursively into the destination's existing value (cloned when the
// destination holds no container), anything else is assigned by reference, and
// a customizer's non-undefined result wins. The destination is mutated in place
// and returned, as lodash does.

type MergeContainer = StaticObjectValue | StaticListValue;

const isCallable = (value: StaticValue | undefined): boolean =>
  value?.kind === "function" || value?.kind === "native-function";

const isPlainObjectValue = (value: StaticValue): value is StaticObjectValue =>
  value.kind === "object" && value.constructedBy === undefined && value.prototype === undefined;

/** False for values whose lodash `isObject`/`isPlainObject` verdict the analysis cannot settle. */
const isDecided = (value: StaticValue): boolean => {
  switch (value.kind) {
    case "unknown":
    case "branch":
    case "repeat":
    case "optional":
    case "external":
    case "proxy":
    case "element":
      return false;
    case "unknown-primitive":
      return value.primitiveType !== "any";
    default:
      return true;
  }
};

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const getContainerKeys = (container: MergeContainer): string[] | null => {
  if (container.kind === "object") return getKnownObjectKeys(container);
  if (!hasDefiniteItems(container)) return null;
  const propertyKeys = [...(container.properties?.keys() ?? [])].filter(
    (key) => !container.nonEnumerableKeys?.has(key),
  );
  return [...container.items.map((_, index) => String(index)), ...propertyKeys];
};

const readMember = (container: MergeContainer, key: string): StaticValue | null => {
  if (container.kind === "object") {
    return getObjectAccessor(container, key) ? null : getObjectProperty(container, key);
  }
  const index = toIndexKey(key);
  if (index === null) return container.properties?.get(key) ?? UNDEFINED_VALUE;
  if (!hasDefiniteItems(container)) return null;
  return container.items[index] ?? UNDEFINED_VALUE;
};

const writeMember = (
  container: MergeContainer,
  key: string,
  value: StaticValue,
  tools: StubRenderTools,
): boolean => {
  if (container.kind === "object") {
    tools.setProperty(container, key, value);
    return true;
  }
  const index = toIndexKey(key);
  if (index === null) return false;
  tools.setItem(container, index, value);
  return true;
};

const cloneContainer = (source: MergeContainer): MergeContainer => {
  if (source.kind === "list") return listValue([]);
  const clone = objectValue();
  if (source.hasNullPrototype) clone.hasNullPrototype = true;
  return clone;
};

const isContainer = (value: StaticValue): value is MergeContainer =>
  value.kind === "list" || value.kind === "object";

/** What `baseMergeDeep` recurses into: arrays and plain objects. */
const isMergeableSource = (value: StaticValue): value is MergeContainer =>
  value.kind === "list" || isPlainObjectValue(value);

class StaticMerger {
  private readonly visiting = new Set<StaticValue>();

  constructor(
    private readonly tools: StubRenderTools,
    private readonly customizer: StaticValue | undefined,
  ) {}

  /** False when the merge touches values whose shape or identity the source does not decide. */
  merge(destination: MergeContainer, source: MergeContainer): boolean {
    if (destination === source) return true;
    if (this.visiting.has(source)) return false;
    const keys = getContainerKeys(source);
    if (keys === null) return false;
    this.visiting.add(source);
    try {
      for (const key of keys) {
        if (!this.mergeKey(destination, source, key)) return false;
      }
      return true;
    } finally {
      this.visiting.delete(source);
    }
  }

  private mergeKey(destination: MergeContainer, source: MergeContainer, key: string): boolean {
    const sourceValue = readMember(source, key);
    const destinationValue = readMember(destination, key);
    if (sourceValue === null || destinationValue === null || !isDecided(sourceValue)) return false;
    const customized = this.customize(destinationValue, sourceValue, key, destination, source);
    if (customized === null) return false;
    if (!isUndefined(customized)) return writeMember(destination, key, customized, this.tools);
    if (!isMergeableSource(sourceValue)) {
      if (isUndefined(sourceValue) && !isUndefined(destinationValue)) return true;
      return writeMember(destination, key, sourceValue, this.tools);
    }
    const target = this.chooseTarget(destinationValue, sourceValue);
    if (target === null || !this.merge(target, sourceValue)) return false;
    return writeMember(destination, key, target, this.tools);
  }

  /** The container a nested source merges into: the destination's own when it holds one, else a fresh clone. */
  private chooseTarget(
    destinationValue: StaticValue,
    sourceValue: MergeContainer,
  ): MergeContainer | null {
    if (sourceValue.kind === "list") {
      return destinationValue.kind === "list" ? destinationValue : listValue([]);
    }
    switch (destinationValue.kind) {
      case "object":
      case "list":
        return destinationValue;
      case "primitive":
      case "unknown-primitive":
      case "function":
      case "native-function":
      case "class":
        return isDecided(destinationValue) ? cloneContainer(sourceValue) : null;
      default:
        return null;
    }
  }

  private customize(
    destinationValue: StaticValue,
    sourceValue: StaticValue,
    key: string,
    destination: MergeContainer,
    source: MergeContainer,
  ): StaticValue | null {
    if (this.customizer === undefined) return UNDEFINED_VALUE;
    const result = this.tools.call(this.customizer, [
      destinationValue,
      sourceValue,
      primitiveValue(key),
      destination,
      source,
      unknownValue("lodash merge stack"),
    ]);
    return isDecided(result) ? result : null;
  }
}

const mergeInto = (helperName: string, hasCustomizer: boolean): StaticValue =>
  nativeFunction(helperName, (args, tools) => {
    const [destination, ...rest] = args;
    const customizer = hasCustomizer && isCallable(rest.at(-1)) ? rest.pop() : undefined;
    if (destination === undefined || !isContainer(destination)) {
      return unknownValue(`lodash ${helperName} into ${destination?.kind ?? "nothing"}`);
    }
    const merger = new StaticMerger(tools, customizer);
    for (const source of rest) {
      if (source.kind === "primitive" && !source.value) continue;
      if (!isMergeableSource(source) || !merger.merge(destination, source)) {
        return unknownValue(`lodash ${helperName} of a partially known value`);
      }
    }
    return destination;
  });

export const merge = mergeInto("merge", false);

export const mergeWith = mergeInto("mergeWith", true);
