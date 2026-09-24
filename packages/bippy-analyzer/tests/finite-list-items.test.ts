import { expect, it } from "vite-plus/test";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import {
  listValue,
  mapFiniteListItems,
  objectFromRecord,
  optionalValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import { evaluateGuard, solveGuards, toWitnessModel } from "../src/symbolic/guard-solver.js";
import type { StaticValue } from "../src/types.js";

it("retains shared presence guards, aliases, and the preferred shape", () => {
  const payload = objectFromRecord({ value: primitiveValue(1) });
  const item = optionalValue(payload, "present", null, true, createPathPredicate("present", null));
  const items = [item, item];
  const result = mapFiniteListItems(items, listValue);
  if (result?.kind !== "branch") throw new Error("Expected finite shapes");
  const resolved = getAlternativeGuards(result);
  if (!resolved) throw new Error("Expected shape guards");
  expect(resolved.inputs).toHaveLength(1);
  const lengths = result.alternatives.flatMap((alternative, index) => {
    if (alternative.kind !== "list") throw new Error("Expected list shape");
    expect(alternative.items.every((value) => value === payload)).toBe(true);
    return solveGuards([resolved.guards[index]]) ? [alternative.items.length] : [];
  });
  expect(lengths).toEqual([2, 0]);
  expect(result.alternatives[result.preferredIndex]).toMatchObject({ kind: "list", items: [] });
  expect(items).toEqual([item, item]);
});

it("composes nested presence without inventing independent choices", () => {
  const inner = optionalValue(
    primitiveValue(7),
    "inner",
    null,
    false,
    createPathPredicate("inner", null),
  );
  const outer = optionalValue(inner, "outer", null, true, createPathPredicate("outer", null));
  const result = mapFiniteListItems([outer], (items) => primitiveValue(items.length));
  if (result?.kind !== "branch") throw new Error("Expected finite counts");
  const resolved = getAlternativeGuards(result);
  if (!resolved) throw new Error("Expected count guards");
  expect(resolved.inputs.map((input) => input.label).sort()).toEqual(["inner", "outer"]);
  for (const outerChoice of [0, 1]) {
    for (const innerChoice of [0, 1]) {
      const model = toWitnessModel(
        resolved.inputs.map((input) => ({
          variable: { input: input.id, path: [], measure: "choice" },
          value: input.label === "outer" ? outerChoice : innerChoice,
        })),
      );
      const selected = result.alternatives.filter((_value, index) =>
        evaluateGuard(resolved.guards[index], model),
      );
      expect(selected).toEqual([primitiveValue(outerChoice === 0 && innerChoice === 0 ? 1 : 0)]);
    }
  }
});

it("does not invoke the visitor for indefinite or unguarded presence", () => {
  let visits = 0;
  const visit = (items: StaticValue[]) => {
    visits++;
    return listValue(items);
  };
  expect(
    mapFiniteListItems([{ kind: "repeat", item: primitiveValue(1), location: null }], visit),
  ).toBeNull();
  expect(mapFiniteListItems([optionalValue(primitiveValue(1), "unknown")], visit)).toBeNull();
  expect(visits).toBe(0);
});

it("keeps the existing raw distribution budget", () => {
  const items = Array.from({ length: 5 }, (_value, index) =>
    optionalValue(
      primitiveValue(index),
      "present",
      null,
      false,
      createPathPredicate(`present ${index}`, null),
    ),
  );
  let visits = 0;
  const visit = (present: StaticValue[]) => {
    visits++;
    return listValue(present);
  };
  expect(mapFiniteListItems(items.slice(0, 4), visit)?.kind).toBe("branch");
  expect(visits).toBe(16);
  expect(mapFiniteListItems(items, visit)).toBeNull();
  expect(visits).toBe(16);
});

it("does not cap definite lists or expose their storage to visitors", () => {
  const items = Array.from({ length: 10_000 }, (_value, index) => primitiveValue(index));
  expect(
    mapFiniteListItems(items, (present) => {
      const length = present.length;
      present.pop();
      return primitiveValue(length);
    }),
  ).toEqual(primitiveValue(10_000));
  expect(items).toHaveLength(10_000);
});
