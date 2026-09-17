import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches fork-local bound calls and accessor writes, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 15; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `bound/seed=${seed}/case=${index}`,
        body: `
      const owner = { invoke(value) { return this.offset + value; } };
      const run = (offset, argument) => { const callback = owner.invoke.bind({ offset }, argument); return 'value:' + callback(); };
      if (first) { if (second) return run(${initial}, ${increment}); return run(${initial + 1}, ${increment}); }
      if (second) return run(${initial + 2}, ${increment});
      return run(${initial + 3}, ${increment});
    `,
      });
      cases.push({
        name: `accessor/seed=${seed}/case=${index}`,
        body: `
      let stored = ${initial};
      const target = {};
      Object.defineProperty(target, 'value', { get() { return stored; }, set(value) { stored = value; }, configurable: true, enumerable: true });
      if (first) target.value = ${initial + increment};
      if (second) target.value = ${initial + increment + 1};
      return 'value:' + target.value + ':' + stored;
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it.each([
  {
    name: "conditional bound arguments remain distinct",
    body: `const target = (value) => 'value:' + value; const callback = first ? target.bind(null, 1) : target.bind(null, 2); return callback();`,
  },
  {
    name: "conditional bound receivers remain distinct",
    body: `const owner = { target() { return this.label; } }; const callback = first ? owner.target.bind({ label: 'left' }) : owner.target.bind({ label: 'right' }); return callback();`,
  },
])("preserves $name", (testCase) => checkSymbolicCases([testCase]));
