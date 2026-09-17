import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface BindingOperation {
  name: string;
  source: string;
}

const operations: BindingOperation[] = [
  { name: "assign", source: "value = getRight()" },
  { name: "add", source: "value += getRight()" },
  { name: "and", source: "value &&= getRight()" },
  { name: "or", source: "value ||= getRight()" },
  { name: "nullish", source: "value ??= getRight()" },
  { name: "prefix", source: "++value" },
  { name: "postfix", source: "value++" },
];
const cases = ["const", "let"].flatMap((declaration) =>
  [7, 0, null].flatMap((initial) =>
    operations.map((operation) => {
      const isWrite =
        operation.name === "and"
          ? !!initial
          : operation.name === "or"
            ? !initial
            : operation.name === "nullish"
              ? initial === null
              : true;
      const isIncrement = operation.name === "prefix" || operation.name === "postfix";
      const isKnown = declaration === "const" && isWrite;
      const tracePrefix = isWrite && !isIncrement ? "rhs|" : "";
      const result = isIncrement
        ? Number(initial) + 1
        : operation.name === "add"
          ? Number(initial) + 9
          : 9;
      const name = `${declaration}/${initial}/${operation.name}`;
      return {
        name,
        label: `${isKnown ? "known divergence: " : ""}${name}`,
        isKnown,
        expected: isKnown
          ? `${tracePrefix}error:TypeError:${initial}`
          : `${tracePrefix}after:${isWrite ? result : initial}`,
        actual: JSON.stringify(`${tracePrefix}after:${isWrite ? result : initial}`),
        body: `${declaration} value = ${initial}; const trace = []; const getRight = () => { trace.push('rhs'); return 9; }; try { ${operation.source}; trace.push('after'); } catch (error) { trace.push('error:' + error.name); } return trace.join('|') + ':' + String(value);`,
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);

it.each(["=", "+="])("preserves abrupt right-hand sides before const %s writes", (operator) =>
  checkDifferentialCases([
    {
      name: `const/${operator}/throwing rhs`,
      body: `const value = 7; const getRight = () => { throw 'rhs'; }; try { value ${operator} getRight(); return 'accepted'; } catch (error) { return error + ':' + value; }`,
    },
  ]),
);
