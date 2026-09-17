import type { SourceLocation } from "../parse/source-types.js";
import type {
  StaticBranchValue,
  StaticListValue,
  StaticUnknownValue,
  StaticValue,
} from "../types.js";
import { getAlternativeGuards, guardedPredicate } from "./predicates.js";
import {
  branchValue,
  FALSE_VALUE,
  getObjectProperty,
  mapValue,
  TRUE_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

type ThrowCertainty = "never" | "maybe" | "always";

const combineSiblings = (left: ThrowCertainty, right: ThrowCertainty): ThrowCertainty =>
  left === "always" || right === "always"
    ? "always"
    : left === "maybe" || right === "maybe"
      ? "maybe"
      : "never";

interface ListCertainty {
  items: readonly StaticValue[];
  certainty: ThrowCertainty;
}

/** Branches, optionals and repeats are immutable; a list's entry is dropped when it mutates (`forgetThrowCertainty`) or its items are swapped. */
const certaintyCache = new WeakMap<StaticValue, ThrowCertainty>();
const listCertaintyCache = new WeakMap<StaticListValue, ListCertainty>();

export const forgetThrowCertainty = (list: StaticListValue): void => {
  listCertaintyCache.delete(list);
};

const getListThrowCertainty = (list: StaticListValue): ThrowCertainty => {
  const cached = listCertaintyCache.get(list);
  if (cached && cached.items === list.items) return cached.certainty;
  const certainty = computeThrowCertainty(list);
  listCertaintyCache.set(list, { items: list.items, certainty });
  return certainty;
};

const computeThrowCertainty = (value: StaticValue): ThrowCertainty => {
  switch (value.kind) {
    case "unknown":
      return value.thrown ? "always" : "never";
    case "list": {
      let certainty: ThrowCertainty = "never";
      for (const item of value.items) {
        certainty = combineSiblings(certainty, getThrowCertainty(item));
        if (certainty === "always") break;
      }
      return certainty;
    }
    case "branch": {
      const outcomes = value.alternatives.map(getThrowCertainty);
      if (outcomes.every((outcome) => outcome === "always")) return "always";
      return outcomes.every((outcome) => outcome === "never") ? "never" : "maybe";
    }
    case "optional":
    case "repeat":
      return getThrowCertainty(value.kind === "optional" ? value.value : value.item) === "never"
        ? "never"
        : "maybe";
    default:
      return "never";
  }
};

/** Whether the paths `value` stands for throw; elements throw from their own proxies. */
export const getThrowCertainty = (value: StaticValue): ThrowCertainty => {
  switch (value.kind) {
    case "branch":
    case "optional":
    case "repeat":
      break;
    case "list":
      return getListThrowCertainty(value);
    default:
      return computeThrowCertainty(value);
  }
  const cached = certaintyCache.get(value);
  if (cached) return cached;
  const certainty = computeThrowCertainty(value);
  certaintyCache.set(value, certainty);
  return certainty;
};

export const getThrowCondition = (value: StaticValue): StaticValue => {
  const certainty = getThrowCertainty(value);
  if (certainty === "always") return TRUE_VALUE;
  if (certainty === "never") return FALSE_VALUE;
  return value.kind === "branch"
    ? mapValue(value, getThrowCondition)
    : unknownPrimitiveValue("boolean", "value may throw");
};

/** The operand whose evaluation certainly threw, so the operation never runs; null when every operand may produce a value. */
export const getThrownOperand = (operands: StaticValue[]): StaticValue | null =>
  operands.find((operand) => getThrowCertainty(operand) === "always") ?? null;

const collectThrows = (value: StaticValue, throws: StaticUnknownValue[]): void => {
  switch (value.kind) {
    case "unknown":
      if (value.thrown) throws.push(value);
      return;
    case "list":
      for (const item of value.items) collectThrows(item, throws);
      return;
    case "branch":
      for (const alternative of value.alternatives) collectThrows(alternative, throws);
      return;
    case "optional":
      collectThrows(value.value, throws);
      return;
    case "repeat":
      collectThrows(value.item, throws);
      return;
    default:
      return;
  }
};

export const findThrown = (value: StaticValue): StaticUnknownValue | null => {
  const throws: StaticUnknownValue[] = [];
  collectThrows(value, throws);
  return throws[0] ?? null;
};

/** What a `catch` around `value` binds: every value some path of it throws. */
export const getCaughtValue = (
  value: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  if (value.kind === "branch" && getThrowCertainty(value) === "always") {
    return mapValue(value, (alternative) => getCaughtValue(alternative, location));
  }
  const throws: StaticUnknownValue[] = [];
  collectThrows(value, throws);
  const caught = throws.flatMap((thrown) => thrown.thrown ?? []);
  return caught.length === 1 ? caught[0] : branchValue(caught, "caught error", location);
};

const describeThrownValue = (thrown: StaticValue | undefined): string => {
  if (!thrown) return "";
  const message = thrown.kind === "object" ? getObjectProperty(thrown, "message") : thrown;
  return message.kind === "primitive" && typeof message.value === "string"
    ? ` (${JSON.stringify(message.value)})`
    : "";
};

export const describeThrow = (value: StaticValue): string => {
  const thrown = findThrown(value);
  if (!thrown) return "component throws";
  const where = thrown.location ? ` at ${thrown.location.filePath}:${thrown.location.line}` : "";
  return `${thrown.reason}${where}${describeThrownValue(thrown.thrown)}`;
};

const selectBranchPaths = (
  value: StaticBranchValue,
  indices: number[],
  transform: (alternative: StaticValue) => StaticValue = (alternative) => alternative,
): StaticValue => {
  const resolved = getAlternativeGuards(value);
  return branchValue(
    indices.map((index) => transform(value.alternatives[index])),
    value.reason,
    value.location,
    Math.max(0, indices.indexOf(value.preferredIndex)),
    resolved
      ? guardedPredicate(
          indices.map((index) => resolved.guards[index]),
          [resolved.inputs],
        )
      : null,
  );
};

/** `value` restricted to the paths that do not throw; a lone thrown path becomes a plain unknown. */
export const withoutThrows = (value: StaticValue): StaticValue => {
  switch (value.kind) {
    case "unknown":
      return value.thrown ? unknownValue("thrown render", value.location) : value;
    case "list":
      return { ...value, items: value.items.map(withoutThrows) };
    case "branch": {
      const surviving = value.alternatives.flatMap((alternative, index) =>
        getThrowCertainty(alternative) !== "always" ? [index] : [],
      );
      return surviving.length === 0
        ? unknownValue("thrown render", value.location)
        : selectBranchPaths(value, surviving, withoutThrows);
    }
    case "optional":
      return { ...value, value: withoutThrows(value.value) };
    case "repeat":
      return { ...value, item: withoutThrows(value.item) };
    default:
      return value;
  }
};

/** The paths of `value` that certainly throw, or null when none does. */
export const getThrownPaths = (value: StaticValue): StaticValue | null => {
  switch (getThrowCertainty(value)) {
    case "always":
      return value;
    case "never":
      return null;
    case "maybe": {
      if (value.kind !== "branch") return null;
      const thrown = value.alternatives.flatMap((alternative, index) =>
        getThrowCertainty(alternative) === "always" ? [index] : [],
      );
      return thrown.length === 0 ? null : selectBranchPaths(value, thrown);
    }
  }
};
