import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

const operators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  ">",
  "<=",
  ">=",
  "==",
  "!=",
  "===",
  "!==",
  "|",
  "&",
  "^",
  "<<",
  ">>",
  ">>>",
  "in",
  "instanceof",
];
const cases = operators.flatMap((operator) =>
  [false, true].flatMap((isLeftThrowing) =>
    [false, true].map((isRightThrowing) => ({
      name: `${operator}/left=${isLeftThrowing}/right=${isRightThrowing}`,
      body: `const trace = []; const getLeft = () => { trace.push('left'); ${isLeftThrowing ? "throw 'left';" : `return ${operator === "in" ? "'value'" : operator === "instanceof" ? "{}" : "7"};`} }; const getRight = () => { trace.push('right'); ${isRightThrowing ? "throw 'right';" : `return ${operator === "in" ? "{ value: 7 }" : operator === "instanceof" ? "class {}" : "2"};`} }; try { getLeft() ${operator} getRight(); trace.push('after'); } catch (error) { trace.push('error:' + error); } return trace.join('|');`,
    })),
  ),
);

it.each(cases)("matches native binary completion: $name", (testCase) =>
  checkDifferentialCases([testCase]),
);

it.each(["&&", "||", "??"])("preserves abrupt logical left operand for %s", (operator) =>
  checkDifferentialCases([
    {
      name: `logical/${operator}`,
      body: `const getLeft = () => { throw 'left'; }; try { getLeft() ${operator} 7; return 'after'; } catch (error) { return error; }`,
    },
  ]),
);

it.each(
  ["&&", "||", "??"].flatMap((operator) =>
    ["null", "0", "7"].map((value) => ({
      name: `${operator}/left=${value}`,
      body: `const trace = []; const getLeft = () => { trace.push('left'); return ${value}; }; const getRight = () => { trace.push('right'); return 9; }; const result = getLeft() ${operator} getRight(); return trace.join('|') + ':' + String(result);`,
    })),
  ),
)("preserves normal logical evaluation $name", (testCase) => checkDifferentialCases([testCase]));
