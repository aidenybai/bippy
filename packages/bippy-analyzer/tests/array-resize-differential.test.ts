import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native resize and reindex histories through aliases, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const initial = Array.from({ length: getRandom(9) }, () => getRandom(21) - 10);
      const statements: string[] = [];
      for (let step = 0; step < 24; step++) {
        const value = getRandom(21) - 10;
        const operations = [
          `values.length = Math.min(values.length, ${getRandom(9)})`,
          `alias.length = Math.min(alias.length, ${getRandom(9)})`,
          `values.push(${value})`,
          `alias.unshift(${value})`,
          `values.splice(${getRandom(9) - 4}, ${getRandom(4)}, ${value})`,
          "alias.reverse()",
          "values.pop()",
          "alias.shift()",
        ];
        statements.push(`
          result = (${operations[getRandom(operations.length)]});
          trace.push(${step} + ':' + String(result) + ':' + values.join(',') + ':' + alias.join(',') + ':' + values.length + ':' + alias.length);
        `);
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
          const values = [${initial.join(",")}];
          const alias = values;
          const trace = [];
          let result;
          ${statements.join("\n")}
          return trace.join('|') + '#' + (values === alias);
        `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "indexed traversal observes a shortened length",
    body: `const values = [1, 2, 3, 4]; const trace = []; for (let index = 0; index < values.length; index++) { trace.push(values[index]); if (index === 0) values.length = 2; } return trace.join(',') + ':' + values.join(',');`,
  },
  {
    name: "indexed traversal observes appended values",
    body: `const values = [1, 2]; const trace = []; for (let index = 0; index < values.length; index++) { trace.push(values[index]); if (index === 0) values.push(3, 4); } return trace.join(',') + ':' + values.join(',');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
