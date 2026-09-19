import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface EqualityConversion {
  name: string;
  source: string;
}

const conversions: EqualityConversion[] = [
  { name: "number", source: "return 7;" },
  { name: "string", source: "return '7';" },
  { name: "object", source: "return {};" },
  { name: "throws", source: "throw 'coercion';" },
];

const cases = ["==", "!=", "===", "!=="].flatMap((operator) =>
  ["7", "null", "undefined", "Symbol('operand')"].flatMap((primitive) =>
    conversions.flatMap((conversion) =>
      [false, true].map((isObjectLeft) => {
        const name = `${operator}/primitive=${primitive}/conversion=${conversion.name}/objectOnLeft=${isObjectLeft}`;
        const isKnown =
          (operator === "==" || operator === "!=") &&
          primitive !== "null" &&
          primitive !== "undefined";
        const trace = isObjectLeft
          ? ["object-expression", "primitive-expression"]
          : ["primitive-expression", "object-expression"];
        const actual = JSON.stringify([...trace, "after"].join("|"));
        if (isKnown) trace.push("convert:default");
        trace.push(
          isKnown && conversion.name === "throws"
            ? "error:coercion"
            : isKnown && conversion.name === "object"
              ? "error:TypeError"
              : "after",
        );
        return {
          name,
          label: `${isKnown ? "known divergence: " : ""}${name}`,
          isKnown,
          expected: trace.join("|"),
          actual,
          body: `
    const trace = [];
    const target = { [Symbol.toPrimitive](hint) { trace.push('convert:' + hint); ${conversion.source} } };
    const getObject = () => { trace.push('object-expression'); return target; };
    const getPrimitive = () => { trace.push('primitive-expression'); return ${primitive}; };
    try { ${isObjectLeft ? "getObject()" : "getPrimitive()"} ${operator} ${isObjectLeft ? "getPrimitive()" : "getObject()"}; trace.push('after'); }
    catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); }
    return trace.join('|');
  `,
        };
      }),
    ),
  ),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);
