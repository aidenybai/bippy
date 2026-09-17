import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  DifferentialMismatch,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches fork-local DataViews and copied call arguments, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 15; index++) {
      const initial = getRandom(100);
      cases.push({
        name: `view/seed=${seed}/case=${index}`,
        body: `
      const sample = (value) => { const view = new DataView(new ArrayBuffer(2)); view.setUint16(0, value, true); return 'word:' + view.getUint16(0, true); };
      if (first) { if (second) return sample(${initial}); return sample(${initial + 1}); }
      if (second) return sample(${initial + 2});
      return sample(${initial + 3});
    `,
      });
      cases.push({
        name: `arguments/seed=${seed}/case=${index}`,
        body: `
      const input = [${initial}];
      const owner = { read() { if (first) arguments[0] = ${initial + 1}; return arguments[0]; } };
      const result = owner.read.call(null, ...input);
      if (second) input[0] = ${initial + 2};
      return 'argument:' + result + ':input:' + input[0];
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

interface NativeBranchCase extends DifferentialCase {
  expected: string[];
  actual: string;
}

const branchCases: NativeBranchCase[] = [
  {
    name: "DataView mutation before an early return",
    expected: ["byte:0", "changed"],
    actual: "[ 'changed', 'byte:9' ]",
    body: `const view = new DataView(new ArrayBuffer(1)); if (first) { view.setUint8(0, 9); return 'changed'; } return 'byte:' + view.getUint8(0);`,
  },
  {
    name: "apply arguments mutation before an early return",
    expected: ["source:1", "changed"],
    actual: "[ 'changed', 'source:9' ]",
    body: `const input = [1]; const owner = { read() { arguments[0] = 9; } }; if (first) { owner.read.apply(null, input); return 'changed'; } return 'source:' + input[0];`,
  },
];

it.each(branchCases)("known divergence: branch isolation: $name", async (testCase) => {
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([testCase]);
});

it.each(
  branchCases.flatMap((testCase) =>
    [false, true].map((first) => ({
      name: `${testCase.name}/${first}`,
      body: `const first = ${first}; ${testCase.body}`,
    })),
  ),
)("matches concrete pin: $name", (testCase) => checkDifferentialCases([testCase]));

it("keeps an Array.from mutation in an early-return branch", () =>
  checkSymbolicCases([
    {
      name: "Array.from early return control",
      body: `const source = [1]; const copy = Array.from(source); if (first) { copy[0] = 9; return 'changed'; } return 'source:' + source[0];`,
    },
  ]));
