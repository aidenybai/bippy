import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ArgumentListForm {
  name: string;
  suffix: string;
}

const forms: ArgumentListForm[] = [
  { name: "omitted", suffix: "" },
  { name: "undefined", suffix: ", undefined" },
  { name: "null", suffix: ", null" },
  { name: "selected nullish", suffix: ", firstValue ? null : undefined" },
  { name: "selected list or null", suffix: ", firstValue ? null : [secondValue ? 2 : 3]" },
];

const cases: DifferentialCase[] = forms
  .flatMap((form) => [
    {
      name: `interpreted function with ${form.name} arguments`,
      body: `const receiver = {value:secondValue ? 7 : 9}; let calls = 0; const target = function() { calls++; return [arguments.length, this === receiver, this.value].join(':'); }; const result = target.apply(receiver${form.suffix}); return result + '|' + calls;`,
    },
    {
      name: `global function with ${form.name} arguments`,
      body: `const result = Array.of.apply(Array${form.suffix}); if (secondValue) result.push(9); return [result.length, result.join(',')].join('|');`,
    },
    {
      name: `bound native wrapper with ${form.name} arguments`,
      body: `const target = Array.of.bind(null, 5); const result = target.apply({}${form.suffix}); if (secondValue) result.push(9); return [result.length, result.join(',')].join('|');`,
    },
    {
      name: `borrowed method with ${form.name} arguments`,
      body: `const source = [1]; if (secondValue) source.push(9); const result = Array.prototype.push.apply(source${form.suffix}); return [result, source.length, source.join(',')].join('|');`,
    },
  ])
  .map((testCase) => ({
    ...testCase,
    body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
  }));

it.each(cases)("matches native nullish apply arguments and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete nullish-apply inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
