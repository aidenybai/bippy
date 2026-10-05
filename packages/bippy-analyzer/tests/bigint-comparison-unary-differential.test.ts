import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface BigIntPair {
  name: string;
  lower: string;
  upper: string;
}
const pairs: BigIntPair[] = [
  { name: "zero", lower: "0n", upper: "1n" },
  { name: "signed", lower: "-3n", upper: "2n" },
  { name: "negative", lower: "-4n", upper: "-2n" },
  { name: "safe integer boundary", lower: "9007199254740992n", upper: "9007199254740993n" },
  { name: "wide positive", lower: `${1n << 128n}n`, upper: `${(1n << 128n) + 1n}n` },
  { name: "wide negative", lower: `${-(1n << 256n)}n`, upper: `${-(1n << 256n) + 1n}n` },
];
const cases: DifferentialCase[] = pairs.flatMap((pair) =>
  ["<", ">", "<=", ">="].map((operator) => ({
    name: `${pair.name}/${operator}`,
    body: `const firstValue=first;const secondValue=second;const left=firstValue?${pair.lower}:${pair.upper};const right=secondValue?${pair.lower}:${pair.upper};return String(left ${operator} right)+':'+(firstValue?'lower':'upper')+':'+(secondValue?'lower':'upper');`,
  })),
);
cases.push(
  ...pairs.flatMap((pair) =>
    ["-", "~", "+"].map((operator) => ({
      name: `${pair.name}/unary ${operator}`,
      body: `const firstValue=first;const secondValue=second;const value=firstValue?${pair.lower}:${pair.upper};try{const result=${operator}value;return typeof result+':'+String(result)+':'+(secondValue?'yes':'no');}catch(error){return error.name+':'+error.message+':'+(secondValue?'yes':'no');}`,
    })),
  ),
);
it.each(cases)("matches native BigInt comparison/unary semantics and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete BigInt comparison/unary inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
