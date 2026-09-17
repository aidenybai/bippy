import { expect, it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  DifferentialMismatch,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(
  ["value", "#value"].flatMap((member) => differentialSeeds.map((seed) => ({ member, seed }))),
)(
  "matches static $member journals across conditional writes, seed $seed",
  async ({ member, seed }) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `${member}/seed=${seed}/case=${index}`,
        body: `
      class Counter {
        static ${member} = ${initial};
        static add(amount) { this.${member} += amount; }
        static read() { return this.${member}; }
      }
      if (first) {
        Counter.add(${increment});
      } else {
        Counter.add(${increment * 2});
      }
      if (second) Counter.add(${increment * 3});
      return String(Counter.read());
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

const witnesses = [
  {
    name: "nested scalar mutations preserve repeated condition correlations",
    expected: ["2", "5", "1", "8"],
    actual: "[ '8', '4', '5', '1', '2' ]",
    body: `let value = 0; if (first) { value = 1; if (second) value += 4; } else { value = 2; } if (second) value += 3; return String(value);`,
  },
  {
    name: "scalar nested early return excludes later updates",
    body: `let value = 0; if (first) { value = 1; if (second) return String(value); } else { value = 2; } if (second) value += 3; return String(value);`,
  },
  {
    name: "object nested early return excludes later updates",
    body: `const target = { value: 0 }; if (first) { target.value = 1; if (second) return String(target.value); } else { target.value = 2; } if (second) target.value += 3; return String(target.value);`,
  },
  {
    name: "static nested early return excludes later updates",
    body: `class Counter { static value = 0; static add(amount) { this.value += amount; } static read() { return this.value; } } if (first) { Counter.add(1); if (second) return String(Counter.read()); } else { Counter.add(2); } if (second) Counter.add(3); return String(Counter.read());`,
  },
  {
    name: "private static nested early return excludes later updates",
    body: `class Counter { static #value = 0; static add(amount) { this.#value += amount; } static read() { return this.#value; } } if (first) { Counter.add(1); if (second) return String(Counter.read()); } else { Counter.add(2); } if (second) Counter.add(3); return String(Counter.read());`,
  },
].map((testCase) => ({
  ...testCase,
  expected: testCase.expected ?? ["2", "5", "1"],
  actual: testCase.actual ?? "[ '1', '4', '5', '2' ]",
}));

it.each(witnesses)("known precision gap: $name", async (testCase) => {
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(
  witnesses.flatMap((testCase) =>
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
)("matches concrete pin $name", (testCase) => checkDifferentialCases([testCase]));
