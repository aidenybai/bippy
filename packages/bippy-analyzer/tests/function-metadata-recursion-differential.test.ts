import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [
  {
    name: "same-valued property writes retain captured counter progress",
    body: "let count=0;const visit=function recurse(input){recurse.marker=0;if(count++<2)return recurse(input);return count;};visit.marker=0;return visit(first);",
  },
  {
    name: "signed zero property progress",
    body: "const visit=function recurse(input){if(Object.is(recurse.marker,0)){recurse.marker=-0;return recurse(input);}return 'done:'+Object.is(recurse.marker,-0);};visit.marker=0;return visit(first);",
  },
  {
    name: "NaN property progress",
    body: "const visit=function recurse(input){if(Number.isNaN(recurse.marker)){recurse.marker=1;return recurse(input);}return 'done:'+recurse.marker;};visit.marker=NaN;return visit(first);",
  },
  {
    name: "fresh reference property progress",
    body: "const original={};const visit=function recurse(input){if(recurse.marker===original){recurse.marker={};return recurse(input);}return 'done:'+(recurse.marker===original);};visit.marker=original;return visit(first);",
  },
  {
    name: "fresh symbol property progress",
    body: "const original=Symbol('marker');const visit=function recurse(input){if(recurse.marker===original){recurse.marker=Symbol('marker');return recurse(input);}return 'done:'+(recurse.marker===original);};visit.marker=original;return visit(first);",
  },
];
it.each(cases)("retains recursive property progress and replay: $name", (testCase) =>
  checkSymbolicCases([{ ...testCase, body: `return String((()=>{${testCase.body}})());` }]),
);
it.each(cases)("retains concrete recursive property progress: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
