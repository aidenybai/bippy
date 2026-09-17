import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches finite Promise.all values through exhaustive replay, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      let result = 'pending';
      const firstPromise = Promise.resolve(first ? ${initial} : ${initial + increment});
      const secondPromise = Promise.resolve(second ? ${initial + 1} : ${initial + increment + 1});
      Promise.all([firstPromise, secondPromise, firstPromise]).then((values) => { result = values.join(','); });
      return () => result;
    `,
      });
    }
    await checkSymbolicCases(cases, true);
  },
);
