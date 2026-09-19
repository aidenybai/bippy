import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches configurable data/accessor conversion histories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const statements: string[] = [];
      for (let step = 0; step < 6; step++) {
        const value = getRandom(30);
        const key = step % 2 === 0 ? "textKey" : "symbolKey";
        const descriptor =
          Math.floor(step / 2) % 2 === 0
            ? `{ value: ${value}, writable: true, configurable: true, enumerable: ${getRandom(2) === 1} }`
            : `{ get: () => { trace.push('get:${step}'); return stored; }, set: (value) => { trace.push('set:${step}:' + value); stored = value; }, configurable: true, enumerable: ${getRandom(2) === 1} }`;
        statements.push(
          `Object.defineProperty(target, ${key}, ${descriptor}); trace.push('before:' + target[${key}]); target[${key}] = ${value + 1}; trace.push('after:' + target[${key}]);`,
        );
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const target = {}; const textKey = 'value'; const symbolKey = Symbol('value'); const trace = []; let stored = 3; ${statements.join("\n")} return trace.join('|');`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const matrix = [false, true].flatMap((isAccessor) =>
  [false, true].flatMap((configurable) =>
    [false, true].flatMap((enumerable) =>
      [false, true].map((isSymbol) => {
        const name = `${isAccessor ? "accessor-to-data" : "data-to-accessor"}/configurable=${configurable}/enumerable=${enumerable}/symbol=${isSymbol}`;
        const converted = isAccessor
          ? "first:19|second:23"
          : "get:new|first:11|set:new:23|get:new|second:23";
        const original = isAccessor
          ? "caught:TypeError|get:old|first:11|set:old:23|get:old|second:23"
          : "caught:TypeError|first:7|second:23";
        return {
          name,
          configurable,
          label: `${configurable ? "" : "known divergence: "}${name}`,
          expected: configurable ? converted : original,
          actual: JSON.stringify(converted),
          body: `
      const trace = []; const target = {}; const key = ${isSymbol ? "Symbol('value')" : "'value'"}; let stored = 11;
      Object.defineProperty(target, key, {
        ${isAccessor ? "get: () => { trace.push('get:old'); return stored; }, set: (value) => { trace.push('set:old:' + value); stored = value; }," : "value: 7, writable: true,"}
        configurable: ${configurable}, enumerable: ${enumerable}
      });
      try { Object.defineProperty(target, key, {
        ${isAccessor ? "value: 19, writable: true," : "get: () => { trace.push('get:new'); return stored; }, set: (value) => { trace.push('set:new:' + value); stored = value; },"}
        configurable: ${configurable}, enumerable: ${enumerable}
      }); } catch (error) { trace.push('caught:' + error.name); }
      trace.push('first:' + target[key]); target[key] = 23; trace.push('second:' + target[key]);
      return trace.join('|');
    `,
        };
      }),
    ),
  ),
);

it.each(matrix)("$label", ({ name, body, expected, actual, configurable }) =>
  configurable
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
);
