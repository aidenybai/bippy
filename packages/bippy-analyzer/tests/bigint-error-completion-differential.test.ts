import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface NumericErrorCase {
  name: string;
  operator: string;
  left: string;
  right: string;
}
const operations: NumericErrorCase[] = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
].flatMap((operator) =>
  [false, true].map((isBigIntLeft) => ({
    name: `mixed ${operator}/bigint left=${isBigIntLeft}`,
    operator,
    left: isBigIntLeft ? "firstValue?1n:2n" : "firstValue?1:2",
    right: isBigIntLeft ? "secondValue?2:1" : "secondValue?2n:1n",
  })),
);
for (const source of ["null", "true", "'1'", "undefined"]) {
  for (const operator of ["+", "-", "**", ">>>"]) {
    for (const isBigIntLeft of [false, true]) {
      operations.push({
        name: `mixed ${operator}/${source}/bigint left=${isBigIntLeft}`,
        operator,
        left: isBigIntLeft ? "firstValue?1n:2n" : source,
        right: isBigIntLeft ? source : "secondValue?2n:1n",
      });
    }
  }
}
operations.push(
  {
    name: "division by zero",
    operator: "/",
    left: "firstValue?1n:2n",
    right: "secondValue?0n:-0n",
  },
  {
    name: "remainder by zero",
    operator: "%",
    left: "firstValue?1n:2n",
    right: "secondValue?0n:-0n",
  },
  {
    name: "negative exponent",
    operator: "**",
    left: "firstValue?1n:2n",
    right: "secondValue?-1n:-2n",
  },
  { name: "unsigned shift", operator: ">>>", left: "firstValue?1n:2n", right: "secondValue?1n:2n" },
);
const cases: DifferentialCase[] = operations.flatMap((operation) =>
  [false, true].map((isAssignment) => ({
    name: `${operation.name}/assignment=${isAssignment}`,
    body: `const firstValue=first;const secondValue=second;const trace=[];let writes=0;const holder={get value(){trace.push('get');return ${operation.left};},set value(value){writes++;trace.push('set');if(secondValue)throw 'setter';}};const right=()=>{trace.push('right');return ${operation.right};};try{const result=(holder.value ${operation.operator}${isAssignment ? "=" : ""} right());trace.push('after:'+typeof result);}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return trace.join('|')+':'+writes;`,
  })),
);
it.each(cases)("matches native BigInt error ordering and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete BigInt error inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
