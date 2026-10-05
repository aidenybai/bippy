import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface TemplateForm {
  name: string;
  expression: string;
  left: string;
}
const forms: TemplateForm[] = [
  { name: "plain", expression: "`prefix${left()}:${right()}:${last()}suffix`", left: "1" },
  { name: "nested", expression: "`outer${`inner${left()}:${right()}`}:${last()}`", left: "1" },
  {
    name: "tag substitutions",
    expression: "tag`prefix${left()}:${right()}:${last()}suffix`",
    left: "1",
  },
  { name: "tag callee", expression: "(left())`${right()}:${last()}`", left: "tag" },
  { name: "tag getter", expression: "owner.tag`${right()}:${last()}`", left: "tag" },
];
const cases: DifferentialCase[] = forms.flatMap((form) =>
  ["undefined", "{}", "Symbol('token')"].map((token) => ({
    name: `${form.name}/token=${token}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];const token=${token};const tag=(...values)=>{trace.push('tag:'+values.length);return 'tagged';};const left=()=>{trace.push('left');if(firstValue)throw token;return ${form.left};};const right=()=>{trace.push('right');if(secondValue)throw token;return 2;};const last=()=>{trace.push('last');return 3;};const owner={get tag(){return left();}};try{const result=${form.expression};trace.push('result:'+result);}catch(error){trace.push('caught:'+Object.is(error,token));}return trace.join('|');`,
  })),
);
it.each(cases)("matches native template completion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete template completion inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
