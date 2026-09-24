import { expect, it } from "vite-plus/test";
import { InputRenamer } from "../src/symbolic/input-renamer.js";
import {
  andGuard,
  negateGuard,
  truthyGuard,
  type GuardContext,
  type InputVariable,
  type SymbolicVariable,
} from "../src/symbolic/guards.js";

const createCause = (firstId: string, secondId: string): GuardContext => {
  const first: SymbolicVariable = { input: firstId, path: [], measure: "value" };
  const second: SymbolicVariable = { input: secondId, path: ["enabled"], measure: "value" };
  const inputs: InputVariable[] = [
    { id: firstId, label: "first", source: "unknown", location: null },
    { id: secondId, label: "second", source: "unknown", location: null },
  ];
  return { guard: andGuard([truthyGuard(first), negateGuard(truthyGuard(second))]), inputs };
};

it("preserves input order across global counter digit boundaries", () => {
  const first = createCause("#9", "#10");
  const second = createCause("#11", "#12");
  const firstRenamer = new InputRenamer(first.inputs.map((input) => input.id));
  const secondRenamer = new InputRenamer(second.inputs.map((input) => input.id));
  expect(firstRenamer.renameContext(first)).toEqual(secondRenamer.renameContext(second));
  expect(first.inputs.map((input) => input.id)).toEqual(["#9", "#10"]);
});

it("preserves distinct evaluations with identical source metadata", () => {
  const renamer = new InputRenamer(["#71", "#72"]);
  const inputs: InputVariable[] = ["#71", "#72"].map((inputId) => ({
    id: inputId,
    label: "same call",
    source: "random",
    location: "app.ts:1",
  }));
  expect(renamer.renameInputs(inputs).map((input) => input.id)).toEqual(["#1", "#2"]);
  expect(renamer.renameInputs(inputs.toReversed()).map((input) => input.id)).toEqual(["#1", "#2"]);
});

it("uses one mapping for value predicates, cardinalities, and retained causes", () => {
  const renamer = new InputRenamer();
  const cause = createCause("#81", "#82");
  const predicate = renamer.renamePredicate({
    formula: cause.guard,
    guards: null,
    choice: null,
    inputs: cause.inputs,
  });
  const cardinality = renamer.renameCardinality({
    variable: { input: "#82", path: [], measure: "length" },
    inputs: [cause.inputs[1]],
  });
  expect(predicate.formula).toEqual(renamer.renameContext(cause).guard);
  expect(cardinality.variable.input).toBe(
    predicate.inputs.find((input) => input.label === "second")?.id,
  );
  expect(cardinality.variable.measure).toBe("length");
});
