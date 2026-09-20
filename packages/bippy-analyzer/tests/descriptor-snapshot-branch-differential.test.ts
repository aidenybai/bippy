import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches descriptor snapshots across finite writes and exhaustive replay, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const target = { value: ${initial} };
      const singleSnapshot = Object.getOwnPropertyDescriptor(target, 'value');
      const bulkSnapshot = Object.getOwnPropertyDescriptors(target).value;
      target.value = first ? ${initial} : ${initial + increment};
      if (second) target.value = ${initial + increment * 2};
      return singleSnapshot.value + ':' + bulkSnapshot.value + ':' + target.value;
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

const witnesses = [
  {
    name: "repeated scalar aliases retain finite correlations without reflection",
    body: `const before = first ? 1 : 2; const after = second ? 3 : before; return before + ':' + after + ':' + after;`,
  },
  {
    name: "snapshot and repeated current value retain finite correlations",
    body: `const target = { value: first ? 1 : 2 }; const before = Object.getOwnPropertyDescriptor(target, 'value'); if (second) target.value = 3; const after = Object.getOwnPropertyDescriptors(target).value; return before.value + ':' + after.value + ':' + target.value;`,
  },
];

it.each(witnesses)("preserves $name", (testCase) => checkSymbolicCases([testCase]));

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

it.each([
  {
    name: "conditional snapshot survives a later conditional write",
    body: `const target = { value: first ? 1 : 2 }; const before = Object.getOwnPropertyDescriptor(target, 'value'); if (second) target.value = 3; return String(before.value);`,
  },
  {
    name: "conditional snapshot and current value retain their correlation",
    body: `const target = { value: first ? 1 : 2 }; const before = Object.getOwnPropertyDescriptor(target, 'value'); if (second) target.value = 3; return before.value + ':' + target.value;`,
  },
  {
    name: "conditional snapshots before and after a write retain their correlation",
    body: `const target = { value: first ? 1 : 2 }; const before = Object.getOwnPropertyDescriptor(target, 'value'); if (second) target.value = 3; const after = Object.getOwnPropertyDescriptors(target).value; return before.value + ':' + after.value;`,
  },
  {
    name: "single descriptor of a conditional property value",
    body: `const target = { value: first ? 1 : 2 }; return String(Object.getOwnPropertyDescriptor(target, 'value').value);`,
  },
  {
    name: "bulk descriptor of a conditional property value",
    body: `const target = { value: first ? 1 : 2 }; return String(Object.getOwnPropertyDescriptors(target).value.value);`,
  },
  {
    name: "single descriptor after a conditional write",
    body: `const target = { value: 1 }; if (first) target.value = 2; return String(Object.getOwnPropertyDescriptor(target, 'value').value);`,
  },
  {
    name: "bulk descriptor after a conditional write",
    body: `const target = { value: 1 }; if (first) target.value = 2; return String(Object.getOwnPropertyDescriptors(target).value.value);`,
  },
])("preserves $name", (testCase) => checkSymbolicCases([testCase]));
