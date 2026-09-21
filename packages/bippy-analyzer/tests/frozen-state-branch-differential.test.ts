import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkGuardedCases,
  checkDifferentialCases,
  DifferentialMismatch,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)("matches fresh branch-local frozen objects, seed %i", async (seed) => {
  const getRandom = createSeededRandom(seed);
  const cases: DifferentialCase[] = [];
  for (let index = 0; index < 10; index++) {
    const initial = getRandom(30);
    cases.push({
      name: `seed=${seed}/case=${index}`,
      body: `
      const run = (freeze) => {
        const target = { value: ${initial} };
        if (freeze) Object.freeze(target);
        return Object.isFrozen(target) + ':' + target.value;
      };
      if (first) { if (second) return run(true); return run(false); }
      return run(false);
    `,
    });
  }
  await checkSymbolicCases(cases);
});

const witnesses = [
  {
    name: "conditional object freezing preserves the unfrozen alternative",
    isSupported: true,
    body: `const shouldFreeze = first; const target = {}; if (shouldFreeze) Object.freeze(target); return String(Object.isFrozen(target));`,
  },
  {
    name: "conditional array freezing preserves the unfrozen alternative",
    isSupported: false,
    body: `const shouldFreeze = first; const target = []; if (shouldFreeze) Object.freeze(target); return String(Object.isFrozen(target));`,
  },
  {
    name: "early return after freezing does not freeze the sibling path",
    isSupported: true,
    body: `const shouldFreeze = first; const target = {}; if (shouldFreeze) { Object.freeze(target); return String(Object.isFrozen(target)); } return String(Object.isFrozen(target));`,
  },
].map((testCase) => ({
  ...testCase,
  label: `${testCase.isSupported ? "preserves" : "known precision gap:"} ${testCase.name}`,
  expected: ["false", "true"],
  actual: "[ 'true' ]",
}));

it.each(witnesses)("$label", async (testCase) => {
  if (testCase.isSupported) {
    await checkGuardedCases([testCase]);
    await checkSymbolicCases([testCase]);
    return;
  }
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(
  witnesses.flatMap((testCase) =>
    [false, true].map((first) => ({
      name: `${testCase.name}/first=${first}`,
      body: `const first = ${first}; ${testCase.body}`,
    })),
  ),
)("matches concrete freeze pin $name", (testCase) => checkDifferentialCases([testCase]));
