import { expect, it } from "vite-plus/test";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import {
  branchValue,
  falsyCounterpart,
  primitiveValue,
  truthyCounterpart,
} from "../src/evaluate/values.js";
import { evaluateGuard, toWitnessModel } from "../src/symbolic/guard-solver.js";
import type { StaticValue } from "../src/types.js";

interface CounterpartCase {
  name: string;
  values: StaticValue[];
  survivingIndices: number[];
  getCounterpart: (value: StaticValue) => StaticValue;
}
const cases: CounterpartCase[] = [
  {
    name: "truthy",
    values: [primitiveValue("A"), primitiveValue(false), primitiveValue("B")],
    survivingIndices: [0, 2],
    getCounterpart: truthyCounterpart,
  },
  {
    name: "falsy",
    values: [primitiveValue(true), primitiveValue(0), primitiveValue("")],
    survivingIndices: [1, 2],
    getCounterpart: falsyCounterpart,
  },
];
it.each(cases)("preserves $name guards and preferred alternatives", (testCase) => {
  for (let preferredIndex = 0; preferredIndex < testCase.values.length; preferredIndex++) {
    const original = branchValue(
      testCase.values,
      testCase.name,
      null,
      preferredIndex,
      createPathPredicate(testCase.name, null),
    );
    if (original.kind !== "branch") throw new Error("Expected original branch");
    const selected = testCase.getCounterpart(original);
    if (selected.kind !== "branch") throw new Error("Expected selected branch");
    const originalGuards = getAlternativeGuards(original);
    const selectedGuards = getAlternativeGuards(selected);
    if (!originalGuards || !selectedGuards) throw new Error("Expected retained guards");
    expect(selected.alternatives).toEqual(
      testCase.survivingIndices.map((index) => testCase.values[index]),
    );
    expect(selected.preferredIndex).toBe(
      Math.max(0, testCase.survivingIndices.indexOf(preferredIndex)),
    );
    expect(selectedGuards.inputs).toEqual(originalGuards.inputs);
    for (let originalIndex = 0; originalIndex < testCase.values.length; originalIndex++) {
      const model = toWitnessModel([
        {
          variable: { input: originalGuards.inputs[0].id, path: [], measure: "choice" },
          value: originalIndex,
        },
      ]);
      for (const [selectedIndex, guard] of selectedGuards.guards.entries()) {
        expect(evaluateGuard(guard, model)).toBe(
          originalIndex === testCase.survivingIndices[selectedIndex],
        );
      }
    }
  }
});
