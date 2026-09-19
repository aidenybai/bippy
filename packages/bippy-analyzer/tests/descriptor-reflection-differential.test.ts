import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches independent reflected descriptor snapshots, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(20);
      const replacement = 20 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      let reads = 0;
      let stored = ${initial};
      const target = { value: ${initial} };
      const getter = () => { reads++; return stored; };
      Object.defineProperty(target, 'accessor', { get: getter, configurable: true, enumerable: true });
      const previous = Object.getOwnPropertyDescriptors(target);
      target.value = ${replacement};
      stored = ${replacement + 1};
      const current = Object.getOwnPropertyDescriptors(target);
      const reflectionReads = reads;
      previous.value.value = ${replacement + 2};
      return previous.value.value + ':' + current.value.value + ':' + target.value + ':' + reflectionReads + ':' + (previous.accessor.get === getter) + ':' + previous.accessor.get();
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const dataCases = Array.from({ length: 8 }, (_value, flags) => ({
  writable: (flags & 1) !== 0,
  configurable: (flags & 2) !== 0,
  enumerable: (flags & 4) !== 0,
  flags,
})).flatMap(({ writable, configurable, enumerable, flags }) =>
  [false, true].map((bulk) => {
    const isKnown = !writable || !configurable;
    const name = `data flags=${flags}/bulk=${bulk}`;
    return {
      name,
      label: `${isKnown ? "known divergence: " : ""}${name}`,
      isKnown,
      body: `const target = {}; Object.defineProperty(target, 'value', { value: 7, writable: ${writable}, configurable: ${configurable}, enumerable: ${enumerable} }); const descriptor = ${bulk ? "Object.getOwnPropertyDescriptors(target).value" : "Object.getOwnPropertyDescriptor(target, 'value')"}; return descriptor.value + ':' + descriptor.writable + ':' + descriptor.configurable + ':' + descriptor.enumerable;`,
      expected: `7:${writable}:${configurable}:${enumerable}`,
      actual: JSON.stringify(`7:true:true:${enumerable}`),
    };
  }),
);

it.each(dataCases)("$label", ({ name, body, isKnown, expected, actual }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);

const accessorCases = Array.from({ length: 4 }, (_value, flags) => ({
  configurable: (flags & 1) !== 0,
  enumerable: (flags & 2) !== 0,
  flags,
})).flatMap(({ configurable, enumerable, flags }) =>
  [false, true].map((bulk) => {
    const name = `accessor flags=${flags}/bulk=${bulk}`;
    return {
      name,
      label: `${configurable ? "" : "known divergence: "}${name}`,
      configurable,
      body: `let calls = 0; const getter = () => { calls++; return 7; }; const target = {}; Object.defineProperty(target, 'value', { get: getter, configurable: ${configurable}, enumerable: ${enumerable} }); const descriptor = ${bulk ? "Object.getOwnPropertyDescriptors(target).value" : "Object.getOwnPropertyDescriptor(target, 'value')"}; return (descriptor.get === getter) + ':' + String(descriptor.set) + ':' + descriptor.configurable + ':' + descriptor.enumerable + ':' + calls;`,
      expected: `true:undefined:${configurable}:${enumerable}:0`,
      actual: JSON.stringify(`true:undefined:true:${enumerable}:0`),
    };
  }),
);

it.each(accessorCases)("$label", ({ name, body, configurable, expected, actual }) =>
  configurable
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
);
