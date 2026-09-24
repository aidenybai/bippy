import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface CandidatePair {
  name: string;
  first: string;
  second: string;
}
const pairs: CandidatePair[] = [
  { name: "signed zeros", first: "0", second: "-0" },
  { name: "NaN and zero", first: "NaN", second: "0" },
  { name: "two NaNs", first: "NaN", second: "NaN" },
  { name: "number and bigint", first: "1", second: "1n" },
  { name: "distinct symbols", first: "Symbol('entry')", second: "Symbol('entry')" },
  { name: "registered symbols", first: "Symbol.for('entry')", second: "Symbol.for('entry')" },
  { name: "distinct objects", first: "{}", second: "{}" },
  { name: "aliased objects", first: "{}", second: "firstCandidate" },
  { name: "distinct arrays", first: "[]", second: "[]" },
  {
    name: "coercion hooks do not run",
    first: "{valueOf(){throw 'valueOf';},toString(){throw 'toString';}}",
    second: "{}",
  },
];
const cases: DifferentialCase[] = pairs.flatMap((pair) =>
  [false, true].map((isInverted) => ({
    name: `${pair.name}/inverted=${isInverted}`,
    body: `const firstValue=first;const secondValue=second;const firstCandidate=${pair.first};const secondCandidate=${pair.second};const left=firstValue?firstCandidate:secondCandidate;const right=secondValue?${isInverted ? "secondCandidate:firstCandidate" : "firstCandidate:secondCandidate"};return (Object.is(left,right)?'same':'different')+':'+(firstValue?'A':'B')+':'+(secondValue?'A':'B');`,
  })),
);
it.each(cases)("matches guarded SameValue and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete SameValue inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
