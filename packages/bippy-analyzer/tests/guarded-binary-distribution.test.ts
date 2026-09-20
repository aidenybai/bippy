import { expect, it } from "vite-plus/test";
import {
  createPathPredicate,
  getAlternativeGuards,
  guardedPredicate,
} from "../src/evaluate/predicates.js";
import {
  branchValue,
  describeValue,
  distributeBinary,
  mapValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import { negateGuard } from "../src/symbolic/guards.js";

it("pairs only jointly possible projections of a shared choice", () => {
  const source = branchValue(
    [0, 1, 2].map(primitiveValue),
    "cursor",
    null,
    1,
    createPathPredicate("cursor", null),
  );
  const done = mapValue(source, (value) =>
    primitiveValue(value.kind === "primitive" && value.value !== 0),
  );
  const calls: string[] = [];
  const result = distributeBinary(source, done, (left, right) => {
    const observation = `${describeValue(left)}:${describeValue(right)}`;
    calls.push(observation);
    return primitiveValue(observation);
  });
  expect(calls).toEqual(["0:false", "1:true", "2:true"]);
  expect(result).toMatchObject({
    kind: "branch",
    preferredIndex: 1,
    alternatives: calls.map(primitiveValue),
  });
  if (result?.kind !== "branch" || source.kind !== "branch") throw new Error("Expected choices");
  expect(getAlternativeGuards(result)?.inputs).toEqual(getAlternativeGuards(source)?.inputs);
});

it("retains the full product for independent choices", () => {
  const left = branchValue(
    [0, 1].map(primitiveValue),
    "left",
    null,
    0,
    createPathPredicate("left", null),
  );
  const right = branchValue(
    [2, 3].map(primitiveValue),
    "right",
    null,
    0,
    createPathPredicate("right", null),
  );
  const result = distributeBinary(left, right, (first, second) =>
    primitiveValue(`${describeValue(first)}:${describeValue(second)}`),
  );
  expect(result).toMatchObject({
    kind: "branch",
    alternatives: ["0:2", "0:3", "1:2", "1:3"].map(primitiveValue),
  });
});

it("preserves the original raw product budget before evaluating any pair", () => {
  const left = branchValue([0, 1, 2, 3, 4].map(primitiveValue), "left");
  const right = branchValue([5, 6, 7, 8].map(primitiveValue), "right");
  let calls = 0;
  expect(
    distributeBinary(left, right, () => {
      calls++;
      return primitiveValue(0);
    }),
  ).toBeNull();
  expect(calls).toBe(0);
});

it("does not evaluate disjoint partial choices", () => {
  const source = branchValue(
    [0, 1].map(primitiveValue),
    "condition",
    null,
    0,
    createPathPredicate("condition", null),
  );
  if (source.kind !== "branch") throw new Error("Expected choice");
  const resolved = getAlternativeGuards(source);
  if (!resolved) throw new Error("Expected guarded alternatives");
  const guard = resolved.guards[0];
  const left = branchValue(
    [1, 2].map(primitiveValue),
    "left",
    null,
    0,
    guardedPredicate([guard, guard], [resolved.inputs]),
  );
  const opposite = negateGuard(guard);
  const right = branchValue(
    [3, 4].map(primitiveValue),
    "right",
    null,
    0,
    guardedPredicate([opposite, opposite], [resolved.inputs]),
  );
  let calls = 0;
  expect(
    distributeBinary(left, right, () => {
      calls++;
      return primitiveValue(0);
    }),
  ).toMatchObject({ kind: "unknown", reason: "binary operation has no feasible alternatives" });
  expect(calls).toBe(0);
});
