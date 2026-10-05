import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkGuardedCases,
  checkDifferentialCases,
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

const scalarMutationCase = {
  name: "nested scalar mutations preserve repeated condition correlations",
  body: `let value = 0; if (first) { value = 1; if (second) value += 4; } else { value = 2; } if (second) value += 3; return String(value);`,
};

it("preserves repeated conditions through nested scalar writes", async () => {
  await checkGuardedCases([scalarMutationCase]);
  await checkSymbolicCases([scalarMutationCase]);
});

const witnesses = [
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
];

it.each(witnesses)("preserves completion state: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});

it.each(
  [scalarMutationCase, ...witnesses].flatMap((testCase) =>
    [false, true].flatMap((first) =>
      [false, true].map((second) => ({
        name: `${testCase.name}/first=${first}/second=${second}`,
        body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
      })),
    ),
  ),
)("matches concrete pin $name", (testCase) => checkDifferentialCases([testCase]));
