import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
const constructors = ["[1,2]", "new Uint8Array([1,2])", "new ArrayBuffer(2)"];
const keys = [
  "'extra'",
  "'hidden'",
  "'missing'",
  "'0'",
  "'1'",
  "'2'",
  "'-0'",
  "'01'",
  "'1e0'",
  "'-1'",
  "'length'",
  "'push'",
  "'byteLength'",
  "'BYTES_PER_ELEMENT'",
  "'constructor'",
  "Symbol.iterator",
  "Symbol.toStringTag",
];
const cases: DifferentialCase[] = constructors.flatMap((constructor) =>
  keys.map((key) => ({
    name: `${constructor}/key=${key}`,
    body: `const firstValue=first;const secondValue=second;const source=${constructor};source.extra=firstValue?undefined:1;Object.defineProperty(source,'hidden',{value:secondValue?undefined:2});return (${key} in source)+':'+(firstValue?'first':'other')+':'+(secondValue?'second':'other');`,
  })),
);
for (const constructor of constructors) {
  for (const key of ["01", "-0", "-1", "1e0", "NaN", "Infinity"]) {
    cases.push({
      name: `${constructor}/assigned key=${key}`,
      body: `const firstValue=first;const secondValue=second;const source=${constructor};source[${JSON.stringify(key)}]=firstValue?undefined:2;return (${JSON.stringify(key)} in source)+':'+(firstValue?'first':'other')+':'+(secondValue?'second':'other');`,
    });
  }
}
cases.push({
  name: "selected receiver and property",
  body: "const firstValue=first;const secondValue=second;const source=firstValue?[1,2]:new Uint8Array([1,2]);const key=secondValue?'push':'byteLength';return (key in source)+':'+(firstValue?'array':'typed')+':'+key;",
});
cases.push(
  {
    name: "selected global property",
    body: "const firstValue=!!first;const secondValue=!!second;globalThis.__bippyPresence=undefined;delete globalThis.__bippyMissing;const key=firstValue?'__bippyPresence':secondValue?'Math':'__bippyMissing';return (key in globalThis)+':'+firstValue+':'+secondValue;",
  },
  {
    name: "selected ordinary receiver and inherited property",
    body: "const firstValue=!!first;const secondValue=!!second;const source=firstValue?{entry:undefined}:{};const key=secondValue?'entry':'toString';return (key in source)+':'+firstValue+':'+secondValue;",
  },
  {
    name: "correlated key and receiver",
    body: "const firstValue=!!first;const secondValue=!!second;const source=firstValue?{left:1}:{right:2};const key=firstValue?'left':'right';return (key in source)+':'+firstValue+':'+secondValue;",
  },
);
it.each(cases)("matches native list property presence and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete list property presence inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
