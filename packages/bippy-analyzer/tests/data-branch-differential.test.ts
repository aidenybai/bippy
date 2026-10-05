import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches exhaustive JSON, local regexp and typed-array states, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 15; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `json/seed=${seed}/case=${index}`,
        body: `
      return JSON.stringify({ value: first ? ${initial} : ${initial + increment}, nested: { label: second ? 'on' : 'off' } });
    `,
      });
      cases.push({
        name: `regexp/seed=${seed}/case=${index}`,
        body: `
      const sample = (input, start) => { const pattern = /a/g; pattern.lastIndex = start; const previous = pattern.exec(input); const next = pattern.exec(input); return (previous ? previous.index : 'none') + ':' + (next ? next.index : 'none') + ':' + pattern.lastIndex; };
      if (first) { if (second) return sample('aba', ${getRandom(4)}); return sample('baab', ${getRandom(5)}); }
      if (second) return sample('aaaa', ${getRandom(5)});
      return sample('', 0);
    `,
      });
      cases.push({
        name: `typed-array/seed=${seed}/case=${index}`,
        body: `
      const values = new Uint8Array([${initial}, ${initial + 1}]);
      if (first) values[0] = ${initial + increment};
      if (second) values[1] = ${initial + increment + 1};
      return values.join(',');
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it("matches native types across finite JSON parse input branches", async () => {
  await checkSymbolicCases([
    {
      name: "finite JSON parse types",
      body: `const text = first ? 'true' : '1'; return typeof JSON.parse(text);`,
    },
  ]);
});
