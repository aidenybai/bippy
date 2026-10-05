import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectEntry, StaticValue } from "../types.js";
import { getCollectionItems } from "./collections.js";
import { createErrorValue } from "./errors.js";
import { quoteUnknownString } from "./primitive-shapes.js";
import { getCaughtValue, getThrowCertainty } from "./thrown.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  distributeObjectBranches,
  getKnownObjectKeys,
  getObjectAccessor,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  mapValue,
  objectValue,
  primitiveValue,
  thrownValue,
  toJsonValue,
  unknownPrimitiveValue,
} from "./values.js";

const serializedSnapshots = new WeakMap<StaticValue, StaticValue>();

const getJsonSnapshot = (
  value: StaticValue,
  location: SourceLocation | null,
  ancestors = new Set<StaticValue>(),
): StaticValue | null => {
  if (ancestors.has(value) || (value.kind === "primitive" && typeof value.value === "bigint")) {
    return thrownValue(
      "JSON.stringify failed",
      createErrorValue(
        "TypeError",
        [
          primitiveValue(
            ancestors.has(value)
              ? "Converting circular structure to JSON"
              : "Do not know how to serialize a BigInt",
          ),
        ],
        location,
      ),
      location,
    );
  }
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "number"
        ? primitiveValue(Number.isFinite(value.value) ? value.value || 0 : null)
        : value;
    case "symbol":
    case "function":
    case "native-function":
    case "class":
      return UNDEFINED_VALUE;
    case "unknown-primitive":
      if (value.primitiveType === "string" || value.primitiveType === "boolean") return value;
      if (value.primitiveType !== "number") return null;
      if (
        value.clock ||
        (value.numberRange &&
          Number.isFinite(value.numberRange.min) &&
          Number.isFinite(value.numberRange.max))
      )
        return value;
      return branchValue([value, NULL_VALUE], "JSON number may be non-finite");
    case "branch": {
      const alternatives = value.alternatives.map((alternative) =>
        getJsonSnapshot(alternative, location, ancestors),
      );
      return alternatives.every((alternative) => alternative !== null)
        ? { ...value, alternatives }
        : null;
    }
    case "list": {
      if (!hasDefiniteItems(value) || value.properties?.has("toJSON")) return null;
      ancestors.add(value);
      try {
        const items = value.items.map((item) => {
          const snapshot = getJsonSnapshot(item, location, ancestors);
          return snapshot === null
            ? null
            : mapValue(snapshot, (alternative) =>
                alternative.kind === "primitive" && alternative.value === undefined
                  ? NULL_VALUE
                  : alternative,
              );
        });
        return items.every((item) => item !== null) ? listValue(items) : null;
      } finally {
        ancestors.delete(value);
      }
    }
    case "object": {
      if (value.constructedBy || getCollectionItems(value)) return null;
      const toJSON = getObjectProperty(value, "toJSON");
      if (toJSON.kind !== "primitive" || getObjectAccessor(value, "toJSON")) return null;
      const keys = getKnownObjectKeys(value);
      if (keys === null) return null;
      ancestors.add(value);
      try {
        const entries: StaticObjectEntry[] = [];
        for (const key of keys) {
          if (getObjectAccessor(value, key)) return null;
          const snapshot = getJsonSnapshot(getObjectProperty(value, key), location, ancestors);
          if (snapshot === null) return null;
          if (snapshot.kind === "primitive" && snapshot.value === undefined) continue;
          if (snapshot.kind === "branch") {
            entries.push({
              kind: "spread",
              value: mapValue(snapshot, (alternative) =>
                alternative.kind === "primitive" && alternative.value === undefined
                  ? objectValue()
                  : objectValue([{ kind: "property", key, value: alternative }]),
              ),
            });
          } else {
            entries.push({ kind: "property", key, value: snapshot });
          }
        }
        return objectValue(entries);
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return null;
  }
};

const getJsonErrors = (value: StaticValue): StaticValue => {
  if (value.kind === "object")
    return listValue(value.entries.map((entry) => getJsonErrors(entry.value)));
  if (value.kind === "list") return listValue(value.items.map(getJsonErrors));
  if (value.kind === "branch")
    return { ...value, alternatives: value.alternatives.map(getJsonErrors) };
  return value.kind === "unknown" && value.thrown ? value : UNDEFINED_VALUE;
};

export const stringifyJsonValue = (
  value: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  const snapshot = getJsonSnapshot(value, location);
  if (snapshot === null) return unknownPrimitiveValue("string", "JSON.stringify");
  return mapValue(distributeObjectBranches(snapshot), (alternative) => {
    const errors = getJsonErrors(alternative);
    const certainty = getThrowCertainty(errors);
    if (certainty !== "never") {
      const thrown = thrownValue(
        "JSON.stringify failed",
        getCaughtValue(errors, location),
        location,
      );
      return certainty === "always"
        ? thrown
        : branchValue(
            [thrown, unknownPrimitiveValue("string", "JSON.stringify with unresolved throws")],
            "JSON.stringify may throw",
            location,
          );
    }
    if (alternative.kind === "primitive" && alternative.value === undefined) return alternative;
    const concrete = toJsonValue(alternative);
    if (concrete !== undefined) return primitiveValue(JSON.stringify(concrete));
    const serialized =
      alternative.kind === "unknown-primitive" && alternative.primitiveType === "string"
        ? quoteUnknownString(alternative)
        : {
            ...unknownPrimitiveValue("string", "JSON.stringify"),
            identity: {},
            stringShape: {
              prefix: alternative.kind === "list" ? "[" : alternative.kind === "object" ? "{" : "",
              minLength: 1,
              length: null,
            },
          };
    serializedSnapshots.set(serialized, alternative);
    return serialized;
  });
};

export const parseSerializedJson = (value: StaticValue): StaticValue | null => {
  const snapshot = serializedSnapshots.get(value);
  if (snapshot === undefined) return null;
  const clone = (value: StaticValue): StaticValue => {
    if (value.kind === "list") return listValue(value.items.map(clone));
    if (value.kind === "object")
      return objectValue(value.entries.map((entry) => ({ ...entry, value: clone(entry.value) })));
    if (value.kind === "branch") return { ...value, alternatives: value.alternatives.map(clone) };
    return value;
  };
  return clone(snapshot);
};
