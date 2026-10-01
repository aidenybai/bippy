import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches properties on fresh branch-local wrappers, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const initial = getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const run = (value) => { const boxed = Object(${initial}); boxed.extra = value; return String(boxed.extra); };
      if (first) { if (second) return run(${initial}); return run(${initial + 1}); }
      if (second) return run(${initial + 2}); return run(${initial + 3});
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

const cases = ["7", "'text'", "false", "3n"].flatMap((source) =>
  [false, true].map((isDelete) => ({
    name: `${source}/delete=${isDelete}`,
    expected: ["1", isDelete ? "undefined" : "9"],
    actual: isDelete ? "[ 'undefined' ]" : "[ '9' ]",
    body: `const change = first; const target = Object(${source}); target.extra = 1; if (change) { ${isDelete ? "delete target.extra;" : "target.extra = 9;"} } return String(target.extra);`,
  })),
);

it.each(cases)("known precision gap: native-wrapper property branches $name", async (testCase) => {
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(
  cases.flatMap((testCase) =>
    [false, true].map((first) => ({
      name: `${testCase.name}/first=${first}`,
      body: `const first = ${first}; ${testCase.body}`,
    })),
  ),
)("matches concrete wrapper pin $name", (testCase) => checkDifferentialCases([testCase]));
