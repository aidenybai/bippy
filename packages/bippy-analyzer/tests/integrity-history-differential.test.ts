import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches frozen accessor state and completion histories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(30);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = []; let stored = ${initial};
      const target = { get value() { trace.push('get'); return stored; }, set value(value) { trace.push('set'); ${index % 3 === 0 ? "throw 'blocked';" : "stored = value;"} } };
      Object.freeze(target); const before = Object.isFrozen(target);
      try { target.value = ${initial + increment}; } catch (error) { trace.push(error); }
      const result = target.value;
      return before + ':' + Object.isFrozen(target) + ':' + result + ':' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "deleting the last configurable property can freeze a nonextensible object",
    body: `const target = { value: 7 }; Object.preventExtensions(target); const before = Object.isFrozen(target); delete target.value; return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "tightening writable can freeze a nonextensible nonconfigurable data property",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7, writable: true, configurable: false }); Object.preventExtensions(target); const before = Object.isFrozen(target); Object.defineProperty(target, 'value', { writable: false }); return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "tightening configurable can freeze a nonextensible readonly data property",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7, writable: false, configurable: true }); Object.preventExtensions(target); const before = Object.isFrozen(target); Object.defineProperty(target, 'value', { configurable: false }); return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "sealing a nonextensible accessor-only object changes frozen status",
    body: `const target = { get value() { return 7; } }; Object.preventExtensions(target); const before = Object.isFrozen(target); Object.seal(target); return before + ':' + Object.isFrozen(target);`,
  },
])("known divergence: live integrity metadata $name", (testCase) =>
  checkKnownDifferentialWitnesses([
    { ...testCase, expected: "false:true", actual: '"false:false"' },
  ]),
);

it.each([
  {
    name: "immutable properties alone do not freeze an extensible object",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7, writable: false, configurable: false }); const before = Object.isFrozen(target); Object.defineProperty(target, 'value', { value: 7 }); return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "freezing completes a nonextensible writable data object",
    body: `const target = { value: 7 }; Object.preventExtensions(target); const before = Object.isFrozen(target); Object.freeze(target); return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "freezing completes a sealed writable data object",
    body: `const target = { value: 7 }; Object.seal(target); const before = Object.isFrozen(target); Object.freeze(target); return before + ':' + Object.isFrozen(target);`,
  },
  {
    name: "repeated freezing retains frozen status",
    body: `const target = Object.freeze({ value: 7 }); const before = Object.isFrozen(target); Object.freeze(target); return before + ':' + Object.isFrozen(target);`,
  },
])("preserves integrity history $name", (testCase) => checkDifferentialCases([testCase]));
