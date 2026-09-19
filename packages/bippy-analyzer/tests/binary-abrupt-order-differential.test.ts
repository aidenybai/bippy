import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

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
      label: `${isLeftThrowing ? "known divergence: " : ""}${operator}/left=${isLeftThrowing}/right=${isRightThrowing}`,
      isLeftThrowing,
      body: `const trace = []; const getLeft = () => { trace.push('left'); ${isLeftThrowing ? "throw 'left';" : `return ${operator === "in" ? "'value'" : operator === "instanceof" ? "{}" : "7"};`} }; const getRight = () => { trace.push('right'); ${isRightThrowing ? "throw 'right';" : `return ${operator === "in" ? "{ value: 7 }" : operator === "instanceof" ? "class {}" : "2"};`} }; try { getLeft() ${operator} getRight(); trace.push('after'); } catch (error) { trace.push('error:' + error); } return trace.join('|');`,
    })),
  ),
);

it.each(cases)("$label", ({ name, body, isLeftThrowing }) =>
  isLeftThrowing
    ? checkKnownDifferentialWitnesses([
        { name, body, expected: "left|error:left", actual: '"left|right|error:left"' },
      ])
    : checkDifferentialCases([{ name, body }]),
);

it.each(["&&", "||", "??"])("known divergence: abrupt logical left operand for %s", (operator) =>
  checkKnownDifferentialWitnesses([
    {
      name: `logical/${operator}`,
      expected: "left",
      actual: operator === "&&" ? '"after"' : 'branch("after" | "left")',
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
