import { expect, it } from "vite-plus/test";
import { evaluateGuard, toWitnessModel } from "../src/symbolic/guard-solver.js";
import {
  countGuardAtoms,
  negateGuard,
  simplifyGuard,
  truthyGuard,
  type Guard,
  type SymbolicVariable,
} from "../src/symbolic/guards.js";

interface GuardCombination {
  kind: "and" | "or";
  clauseKind: "and" | "or";
}
const combinations: GuardCombination[] = [
  { kind: "or", clauseKind: "and" },
  { kind: "and", clauseKind: "or" },
];
const variables: SymbolicVariable[] = ["first", "second", "third", "fourth"].map((input) => ({
  input,
  path: [],
  measure: "value",
}));
const [firstGuard, secondGuard, thirdGuard, fourthGuard] = variables.map(truthyGuard);

const checkFactoring = (original: Guard, expectedAtoms: number): void => {
  const simplified = simplifyGuard(original);
  expect(countGuardAtoms(simplified)).toBe(expectedAtoms);
  for (let assignment = 0; assignment < 16; assignment++) {
    const model = toWitnessModel(
      variables.map((variable, index) => ({ variable, value: !!(assignment & (1 << index)) })),
    );
    expect(evaluateGuard(simplified, model)).toBe(evaluateGuard(original, model));
  }
};

it.each(combinations)(
  "factors complementary $kind clauses with reordered common operands",
  ({ kind, clauseKind }) => {
    checkFactoring(
      {
        kind,
        operands: [
          { kind: clauseKind, operands: [firstGuard, secondGuard, thirdGuard] },
          { kind: clauseKind, operands: [negateGuard(thirdGuard), secondGuard, firstGuard] },
        ],
      },
      2,
    );
  },
);
it.each(combinations)("repeatedly factors complementary $kind clauses", ({ kind, clauseKind }) => {
  checkFactoring(
    {
      kind,
      operands: [thirdGuard, negateGuard(thirdGuard)].flatMap((third) =>
        [fourthGuard, negateGuard(fourthGuard)].map((fourth): Guard => ({
          kind: clauseKind,
          operands: [firstGuard, secondGuard, third, fourth],
        })),
      ),
    },
    2,
  );
});
it.each(combinations)(
  "reduces covered positive and negative literals in $kind clauses",
  ({ kind, clauseKind }) => {
    for (const first of [firstGuard, negateGuard(firstGuard)]) {
      checkFactoring(
        {
          kind,
          operands: [first, { kind: clauseKind, operands: [negateGuard(first), secondGuard] }],
        },
        2,
      );
    }
  },
);

it.each(combinations)(
  "preserves distinct noncomplementary $kind clauses",
  ({ kind, clauseKind }) => {
    checkFactoring(
      {
        kind,
        operands: [
          { kind: clauseKind, operands: [firstGuard, secondGuard] },
          { kind: clauseKind, operands: [firstGuard, negateGuard(thirdGuard)] },
        ],
      },
      4,
    );
  },
);
