import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  DifferentialMismatch,
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches explicit UTC calendar normalization, copies and mutations, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const years = [-1, 0, 1, 99, 100, 1900, 2000, 2024];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const timestamp = Date.UTC(${years[index % years.length]}, ${getRandom(19) - 3}, ${getRandom(46) - 5}, ${getRandom(75) - 24}, ${getRandom(150) - 30}, ${getRandom(90) - 15}, ${getRandom(2000) - 500});
      const original = new Date(timestamp);
      const alias = original;
      const copy = new Date(original.getTime());
      const result = original.setUTCDate(${getRandom(46) - 5});
      return copy.toISOString() + '#' + original.toISOString() + '#' + result + '#' + alias.getTime() + '#' + original.getUTCFullYear() + ':' + original.getUTCMonth() + ':' + original.getUTCDate() + '#' + (copy === original);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "invalid dates serialize through toJSON as null",
    body: `return new Date(NaN).toJSON();`,
  },
  {
    name: "explicit timezone offsets normalize to UTC",
    body: `return new Date('2000-01-01T01:30:00+01:30').toISOString();`,
  },
  {
    name: "time clipping rejects values beyond the finite date range",
    body: `return Number.isNaN(new Date(8640000000000001).getTime());`,
  },
  {
    name: "date copies retain their timestamp after source mutation",
    body: `const original = new Date(0); const copy = new Date(original); original.setTime(1000); return copy.getTime();`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

const branchCase = {
  name: "UTC date mutation before an early return",
  body: `const value = new Date(0); if (first) { value.setTime(1000); return 'changed'; } return 'epoch:' + value.getTime();`,
};

it("known divergence: UTC date mutation crosses an early return branch", async () => {
  const failure: unknown = await checkSymbolicCases([branchCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch)
    expect(failure.actual).toEqual([
      { ...branchCase, expected: ["epoch:0", "changed"], actual: "[ 'changed', 'epoch:1000' ]" },
    ]);
});

it("known divergence: invalid ISO conversion does not propagate RangeError", () =>
  checkKnownDifferentialWitnesses([
    {
      name: "invalid ISO conversion throws RangeError",
      body: `try { new Date(NaN).toISOString(); return 'accepted'; } catch (error) { return error.name; }`,
      expected: "RangeError",
      actual: JSON.stringify("accepted"),
    },
  ]));

it.each([false, true])("matches explicit UTC date pin %s", (first) =>
  checkDifferentialCases([
    {
      name: `${branchCase.name}/${first}`,
      body: `const first = ${first}; ${branchCase.body}`,
    },
  ]),
);
