import { it } from "vite-plus/test";
import { checkDifferentialCases, type DifferentialCase } from "./helpers/differential-evaluator.js";

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

const cases: DifferentialCase[] = ["==", "!=", "===", "!=="].flatMap((operator) =>
  ["7", "null", "undefined", "Symbol('operand')"].flatMap((primitive) =>
    conversions.flatMap((conversion) =>
      [false, true].map((isObjectLeft) => ({
        name: `${operator}/primitive=${primitive}/conversion=${conversion.name}/objectOnLeft=${isObjectLeft}`,
        body: `
    const trace = [];
    const target = { [Symbol.toPrimitive](hint) { trace.push('convert:' + hint); ${conversion.source} } };
    const getObject = () => { trace.push('object-expression'); return target; };
    const getPrimitive = () => { trace.push('primitive-expression'); return ${primitive}; };
    try { ${isObjectLeft ? "getObject()" : "getPrimitive()"} ${operator} ${isObjectLeft ? "getPrimitive()" : "getObject()"}; trace.push('after'); }
    catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); }
    return trace.join('|');
  `,
      })),
    ),
  ),
);

it.each(cases)("matches native equality conversion: $name", (testCase) =>
  checkDifferentialCases([testCase]),
);
