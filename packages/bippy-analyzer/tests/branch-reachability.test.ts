import { expect, it } from "vite-plus/test";
import {
  createPathPredicate,
  getAlternativeGuards,
  guardedPredicate,
} from "../src/evaluate/predicates.js";
import { branchValue, primitiveValue } from "../src/evaluate/values.js";
import { constantGuard } from "../src/symbolic/guards.js";

it("removes independently impossible alternatives while retaining guards, inputs, and preference", () => {
  const original = branchValue(
    [primitiveValue(1), primitiveValue(2)],
    "choice",
    null,
    1,
    createPathPredicate("choice", null),
  );
  if (original.kind !== "branch") throw new Error("Expected source branch");
  const resolved = getAlternativeGuards(original);
  if (!resolved) throw new Error("Expected source guards");
  for (const preferredIndex of [0, 1, 2]) {
    const selected = branchValue(
      [primitiveValue(99), ...original.alternatives],
      "reachable choice",
      null,
      preferredIndex,
      guardedPredicate([constantGuard(false), ...resolved.guards], [resolved.inputs]),
    );
    if (selected.kind !== "branch") throw new Error("Expected reachable branch");
    expect(selected.alternatives).toEqual(original.alternatives);
    expect(selected.preferredIndex).toBe(Math.max(0, preferredIndex - 1));
    expect(getAlternativeGuards(selected)).toEqual(resolved);
  }
});

it("removes contradictions introduced by nested branch composition", () => {
  const predicate = createPathPredicate("shared", null);
  const inner = branchValue([primitiveValue(1), primitiveValue(2)], "inner", null, 0, predicate);
  const outer = branchValue([inner, primitiveValue(3)], "outer", null, 1, predicate);
  if (outer.kind !== "branch") throw new Error("Expected reachable outer branch");
  expect(outer.alternatives).toEqual([primitiveValue(1), primitiveValue(3)]);
  expect(outer.preferredIndex).toBe(1);
  if (inner.kind !== "branch") throw new Error("Expected inner branch");
  expect(getAlternativeGuards(outer)).toEqual(getAlternativeGuards(inner));
});

it("does not turn an entirely impossible branch into an unguarded outcome", () => {
  const predicate = guardedPredicate([constantGuard(false), constantGuard(false)], []);
  const value = branchValue(
    [primitiveValue(1), primitiveValue(2)],
    "unreachable",
    null,
    0,
    predicate,
  );
  if (value.kind !== "branch") throw new Error("Expected guarded unreachable branch");
  expect(getAlternativeGuards(value)?.guards).toEqual([constantGuard(false), constantGuard(false)]);
});

it("retains the existing raw 64-alternative construction bound", () => {
  const values = Array.from({ length: 65 }, (_value, index) => primitiveValue(index));
  const predicate = guardedPredicate(
    values.map((_value, index) => constantGuard(index === 0)),
    [],
  );
  expect(branchValue(values, "bounded", null, 0, predicate)).toMatchObject({
    kind: "unknown",
    reason: "bounded: more than 64 alternatives",
  });
});
