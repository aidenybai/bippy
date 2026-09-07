import type { SourceLocation, StaticUnknownValue, StaticValue } from "../types.js";
import { branchValue, getObjectProperty, unknownValue } from "./values.js";

export type ThrowCertainty = "never" | "maybe" | "always";

const combineSiblings = (left: ThrowCertainty, right: ThrowCertainty): ThrowCertainty =>
  left === "always" || right === "always"
    ? "always"
    : left === "maybe" || right === "maybe"
      ? "maybe"
      : "never";

/** Branches, optionals and repeats are immutable, so their certainty is computed once; lists mutate in place and are re-walked. */
const certaintyCache = new WeakMap<StaticValue, ThrowCertainty>();

const computeThrowCertainty = (value: StaticValue): ThrowCertainty => {
  switch (value.kind) {
    case "unknown":
      return value.thrown ? "always" : "never";
    case "list":
      return value.items.map(getThrowCertainty).reduce(combineSiblings, "never");
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
  if (value.kind !== "branch" && value.kind !== "optional" && value.kind !== "repeat") {
    return computeThrowCertainty(value);
  }
  const cached = certaintyCache.get(value);
  if (cached) return cached;
  const certainty = computeThrowCertainty(value);
  certaintyCache.set(value, certainty);
  return certainty;
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

/** `value` restricted to the paths that do not throw; a lone thrown path becomes a plain unknown. */
export const withoutThrows = (value: StaticValue): StaticValue => {
  switch (value.kind) {
    case "unknown":
      return value.thrown ? unknownValue("thrown render", value.location) : value;
    case "list":
      return { ...value, items: value.items.map(withoutThrows) };
    case "branch": {
      const surviving = value.alternatives.filter(
        (alternative) => getThrowCertainty(alternative) !== "always",
      );
      if (surviving.length === 0) return unknownValue("thrown render", value.location);
      const preferred = value.alternatives[value.preferredIndex];
      return branchValue(
        surviving.map(withoutThrows),
        value.reason,
        value.location,
        Math.max(0, surviving.indexOf(preferred)),
      );
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
      const thrown = value.alternatives.filter(
        (alternative) => getThrowCertainty(alternative) === "always",
      );
      return thrown.length === 0 ? null : branchValue(thrown, value.reason, value.location, 0);
    }
  }
};
