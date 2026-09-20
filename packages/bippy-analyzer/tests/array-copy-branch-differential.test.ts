import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "keeps ordinary array copies independent through symbolic mutations, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    const methods = ["slice()", "toReversed()", "toSorted()", "concat([])"];
    for (let index = 0; index < 15; index++) {
      const values = Array.from({ length: 2 + getRandom(5) }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const original = [${values.join(",")}];
      const copy = original.${methods[getRandom(methods.length)]};
      if (first) copy[0] = ${20 + getRandom(20)};
      if (second) original[0] = ${40 + getRandom(20)};
      return original.join(',') + '#' + copy.join(',') + '#' + (original === copy);
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

interface CopyMutation {
  name: string;
  mutation: string;
}

const mutations: CopyMutation[] = [
  { name: "append", mutation: "copy.push(1)" },
  { name: "overwrite", mutation: "copy[0] = 7" },
  { name: "truncate", mutation: "copy.length = 0" },
];

const createCopyCase = (
  { name, mutation }: CopyMutation,
  method: string,
  earlyReturn: boolean,
): DifferentialCase => ({
  name: `${method}/${name}/earlyReturn=${earlyReturn}`,
  body: `const original = [0]; const copy = original.${method}; if (first) { ${mutation}; ${earlyReturn ? "return 'changed';" : ""} } return 'source:' + original.join(',');`,
});

it.each(
  mutations.flatMap((mutation) =>
    [false, true].map((earlyReturn) => createCopyCase(mutation, "toSorted()", earlyReturn)),
  ),
)("preserves singleton copy isolation: $name", (testCase) => checkSymbolicCases([testCase]));

it.each(
  mutations.flatMap((mutation) =>
    [false, true].map((first) => {
      const testCase = createCopyCase(mutation, "toSorted()", true);
      return {
        name: `${testCase.name}/first=${first}`,
        body: `const first = ${first}; ${testCase.body}`,
      };
    }),
  ),
)("matches concrete pin: $name", (testCase) => checkDifferentialCases([testCase]));

it.each(
  mutations.flatMap((mutation) =>
    ["slice()", "toReversed()", "concat([])"].map((method) =>
      createCopyCase(mutation, method, true),
    ),
  ),
)("preserves isolated small copies: $name", (testCase) => checkSymbolicCases([testCase]));
