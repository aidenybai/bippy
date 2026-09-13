import {
  listValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
  isCallable,
  isUndefinedValue,
} from "../evaluate/values.js";
import type { MutableHeapValue } from "../evaluate/heap-journal.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { StaticValue, StubRenderTools } from "../types.js";
import {
  cloneContainer,
  getContainerKeys,
  isContainer,
  isDecided,
  isPlainObjectValue,
  readMember,
  writeMember,
} from "./merge-containers.js";

// Mirrors lodash's `baseMerge`/`baseMergeDeep`: a plain-object or array source
// merges recursively into the destination's existing value (cloned when the
// destination holds no container), anything else is assigned by reference, and
// a customizer's non-undefined result wins. The destination is mutated in place
// and returned, as lodash does.

/** What `baseMergeDeep` recurses into: arrays and plain objects. */
const isMergeableSource = (value: StaticValue): value is MutableHeapValue =>
  value.kind === "list" || isPlainObjectValue(value);

class StaticMerger {
  private readonly visiting = new Set<StaticValue>();

  constructor(
    private readonly tools: StubRenderTools,
    private readonly customizer: StaticValue | undefined,
  ) {}

  /** False when the merge touches values whose shape or identity the source does not decide. */
  merge(destination: MutableHeapValue, source: MutableHeapValue): boolean {
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

  private mergeKey(destination: MutableHeapValue, source: MutableHeapValue, key: string): boolean {
    const sourceValue = readMember(source, key);
    const destinationValue = readMember(destination, key);
    if (sourceValue === null || destinationValue === null || !isDecided(sourceValue)) return false;
    const customized = this.customize(destinationValue, sourceValue, key, destination, source);
    if (customized === null) return false;
    if (!isUndefinedValue(customized)) return writeMember(destination, key, customized, this.tools);
    if (!isMergeableSource(sourceValue)) {
      if (isUndefinedValue(sourceValue) && !isUndefinedValue(destinationValue)) return true;
      return writeMember(destination, key, sourceValue, this.tools);
    }
    const target = this.chooseTarget(destinationValue, sourceValue);
    if (target === null || !this.merge(target, sourceValue)) return false;
    return writeMember(destination, key, target, this.tools);
  }

  /** The container a nested source merges into: the destination's own when it holds one, else a fresh clone. */
  private chooseTarget(
    destinationValue: StaticValue,
    sourceValue: MutableHeapValue,
  ): MutableHeapValue | null {
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
    destination: MutableHeapValue,
    source: MutableHeapValue,
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
