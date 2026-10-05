import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface ObjectForm {
  name: string;
  expression: string;
  left: string;
}
const forms: ObjectForm[] = [
  { name: "value", expression: "({prefix:0,left:left(),right:right(),tail:last()})", left: "1" },
  {
    name: "computed key",
    expression: "({prefix:0,[left()]:right(),tail:last()})",
    left: "'entry'",
  },
  {
    name: "spread",
    expression: "({prefix:0,...left(),right:right(),tail:last()})",
    left: "({entry:1})",
  },
  {
    name: "nested",
    expression: "({prefix:0,nested:{left:left(),right:right()},tail:last()})",
    left: "1",
  },
  {
    name: "accessor prefix",
    expression:
      "({get fixed(){return 9;},left:left(),right:right(),set fixed(value){},tail:last()})",
    left: "1",
  },
  {
    name: "selected key",
    expression:
      "({get fixed(){return 9;},[secondValue?'first':'second']:left(),right:right(),set fixed(value){},tail:last()})",
    left: "1",
  },
];
const cases: DifferentialCase[] = forms.flatMap((form) =>
  ["undefined", "{}", "Symbol('token')"].map((token) => ({
    name: `${form.name}/token=${token}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const token=${token};const left=()=>{trace.push('left');if(firstValue)throw token;return ${form.left};};const right=()=>{trace.push('right');if(secondValue)throw token;return 2;};const last=()=>{trace.push('last');return 3;};try{const result=${form.expression};trace.push('keys:'+Object.keys(result).join(','));}catch(error){trace.push('caught:'+Object.is(error,token));}return trace.join('|');`,
  })),
);
it.each(cases)("matches native object literal completion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete object literal completion inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
