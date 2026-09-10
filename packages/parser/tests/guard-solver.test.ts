import { describe, expect, it } from "vite-plus/test";
import {
  evaluateGuard,
  GuardSolver,
  solveGuards,
  toWitnessModel,
  type WitnessModel,
} from "../src/harness/guard-solver.js";
import {
  andGuard,
  equalsGuard,
  type Guard,
  negateGuard,
  orGuard,
  type SymbolicVariable,
  truthyGuard,
} from "../src/harness/symbolic-tree.js";

const variable = (input: string): SymbolicVariable => ({ input, path: [], measure: "value" });

const evaluateGuardAll = (guards: Guard[], model: WitnessModel): boolean =>
  guards.every((guard) => evaluateGuard(guard, model) === true);

describe("guard solver", () => {
  it("finds a model through nested disjunctions and rejects a contradiction hidden in them", () => {
    const [left, right, third] = ["a", "b", "c"].map(variable);
    const eitherSide = orGuard([truthyGuard(left), truthyGuard(right)]);
    const neitherSide = negateGuard(orGuard([truthyGuard(left), truthyGuard(right)]));
    const model = solveGuards([eitherSide, negateGuard(truthyGuard(left)), truthyGuard(third)]);
    expect(model).not.toBeNull();
    expect(evaluateGuardAll([eitherSide, truthyGuard(right)], toWitnessModel(model ?? []))).toBe(
      true,
    );
    expect(solveGuards([eitherSide, neitherSide])).toBeNull();
  });

  it("keeps every disjunction satisfied by the returned model, not only the ones it split on", () => {
    const [mode, flag] = ["mode", "flag"].map(variable);
    const guards: Guard[] = [
      orGuard([equalsGuard(mode, "compact"), truthyGuard(flag)]),
      orGuard([equalsGuard(mode, "wide"), negateGuard(truthyGuard(flag))]),
      negateGuard(equalsGuard(mode, "compact")),
    ];
    const model = solveGuards(guards);
    expect(model).not.toBeNull();
    expect(evaluateGuardAll(guards, toWitnessModel(model ?? []))).toBe(true);
  });

  it("decides a long chain of negated conjunctions without exploring every split", () => {
    const inputs = Array.from({ length: 40 }, (_, index) => variable(`input-${index}`));
    const guards: Guard[] = inputs.flatMap((input, index) => {
      const next = inputs[(index + 1) % inputs.length];
      return [negateGuard(andGuard([truthyGuard(input), truthyGuard(next)]))];
    });
    const startedAt = performance.now();
    const model = solveGuards([...guards, truthyGuard(inputs[0])]);
    expect(model).not.toBeNull();
    expect(evaluateGuardAll(guards, toWitnessModel(model ?? []))).toBe(true);
    expect(
      solveGuards([...guards, ...inputs.map((input) => truthyGuard(input))]),
    ).toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  it("extends a path by its current witness and re-solves only when the witness fails the guard", () => {
    const [left, right] = ["left", "right"].map(variable);
    const solver = new GuardSolver();
    expect(solver.push(orGuard([truthyGuard(left), truthyGuard(right)]))).toBe(true);
    expect(solver.push(negateGuard(truthyGuard(left)))).toBe(true);
    expect(solver.push(negateGuard(truthyGuard(right)))).toBe(false);
    expect(solver.guards).toHaveLength(2);
    solver.pop();
    expect(solver.push(truthyGuard(left))).toBe(true);
    expect(solver.guards).toHaveLength(2);
  });
});
