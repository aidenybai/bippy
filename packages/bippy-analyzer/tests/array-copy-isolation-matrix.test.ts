import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface CopyMethod {
  name: string;
  expression: string;
}

interface ListWrite {
  name: string;
  statement: string;
}

const methods: CopyMethod[] = [
  { name: "Array.from", expression: "Array.from(original)" },
  { name: "slice", expression: "original.slice()" },
  { name: "concat", expression: "original.concat([])" },
  { name: "toReversed", expression: "original.toReversed()" },
  { name: "toSorted", expression: "original.toSorted()" },
];
const writes: ListWrite[] = [
  { name: "append", statement: "push(9)" },
  { name: "overwrite", statement: "[0] = 9" },
  { name: "truncate", statement: "length = 0" },
];

const campaigns = methods.flatMap((method) =>
  [0, 1, 2].map((length) => {
    const original = JSON.stringify(Array.from({ length }, (_, index) => length - index));
    const cases: DifferentialCase[] = ["original", "copy"].flatMap((target) =>
      writes.flatMap((write) =>
        [false, true].flatMap((throughAlias) =>
          [false, true].map((earlyReturn) => {
            const receiver = throughAlias ? "alias" : target;
            const mutation = `${receiver}${write.name === "overwrite" ? "" : "."}${write.statement}`;
            const other = target === "original" ? "copy" : "original";
            return {
              name: `${method.name}/length=${length}/${target}/${write.name}/alias=${throughAlias}/early=${earlyReturn}`,
              body: `
                const original = ${original};
                const copy = ${method.expression};
                const alias = ${target};
                const snapshot = () => original.join(',') + '#' + copy.join(',') + '#' + (original === copy) + '#' + (alias === ${target});
                if (first) {
                  ${mutation};
                  ${earlyReturn ? "return 'early:' + snapshot();" : ""}
                }
                if (second) ${other}.push(7);
                return 'late:' + snapshot();
              `,
            };
          }),
        ),
      ),
    );
    return { name: `${method.name}/length=${length}`, cases };
  }),
);

it.each(campaigns)("matches all four concrete inputs for $name", ({ cases }) =>
  checkDifferentialCases(
    cases.flatMap((testCase) =>
      [false, true].flatMap((first) =>
        [false, true].map((second) => ({
          name: `${testCase.name}/first=${first}/second=${second}`,
          body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
        })),
      ),
    ),
  ),
);

it.each(campaigns)("matches native states and pinned replay for $name", ({ cases }) =>
  checkSymbolicCases(cases),
);
