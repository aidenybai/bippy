import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface LiteralForm {
  name: string;
  expression: string;
  left: string;
  right: string;
}
const forms: LiteralForm[] = [
  { name: "elements", expression: "[left(),right(),last()]", left: "1", right: "2" },
  { name: "spread first", expression: "[...left(),right(),last()]", left: "[1]", right: "2" },
  { name: "spread second", expression: "[left(),...right(),last()]", left: "1", right: "[2]" },
  { name: "nested", expression: "[[left(),right()],last()]", left: "1", right: "2" },
  { name: "holes", expression: "[,left(),,right(),last()]", left: "1", right: "2" },
  { name: "consumer", expression: "Array.from([left(),right(),last()])", left: "1", right: "2" },
];
const cases: DifferentialCase[] = forms.flatMap((form) =>
  ["undefined", "{}", "Symbol('token')"].map((token) => ({
    name: `${form.name}/token=${token}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const token=${token};const left=()=>{trace.push('left');if(firstValue)throw token;return ${form.left};};const right=()=>{trace.push('right');if(secondValue)throw token;return ${form.right};};const last=()=>{trace.push('last');return 3;};try{const result=${form.expression};trace.push('length:'+result.length);}catch(error){trace.push('caught:'+Object.is(error,token));}return trace.join('|');`,
  })),
);
it.each(cases)("matches native array literal completion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete array literal inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
