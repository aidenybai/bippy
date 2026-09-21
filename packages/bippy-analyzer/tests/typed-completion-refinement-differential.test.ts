import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const constructors = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
];
const cases: DifferentialCase[] = constructors.flatMap((constructor) => [
  ...[`new ${constructor}([1,2])`, `${constructor}.from([1,2])`, `${constructor}.of(1,2)`].map(
    (expression) => ({
      name: `${expression}/completion brand`,
      body: `const firstValue=first;const secondValue=second;const create=()=>{if(firstValue)throw undefined;return ${expression};};try{const result=create();if(secondValue)result[0]=7;return result.join(',')+':'+result.byteLength+':'+ArrayBuffer.isView(result)+':'+(result instanceof ${constructor});}catch(error){return String(error);}`,
    }),
  ),
  {
    name: `${constructor}/completion alias`,
    body: `const firstValue=first;const secondValue=second;const saved=${constructor}.of(1,2);const get=()=>{if(firstValue)throw undefined;return saved;};try{const result=get();result[0]=secondValue?7:8;return saved.join(',')+':'+(result===saved)+':'+ArrayBuffer.isView(result)+':'+result.byteLength;}catch(error){return String(error);}`,
  },
]);
it.each(cases)("matches typed completion refinement and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches concrete typed completion refinement: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
