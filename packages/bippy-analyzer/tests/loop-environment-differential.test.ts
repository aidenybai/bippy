import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches per-call and loop-body captures without shared header bindings, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const count = 1 + getRandom(8);
      const increment = getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const direct = [];
      const staged = [];
      const values = [];
      const capture = (value) => () => value;
      for (let position = 0; position < ${count}; position++) {
        const local = position + ${increment};
        direct.push(() => local);
        staged.push(capture(position));
        values.push(local);
      }
      return direct.map((read) => read()).join(',') + '#' + staged.map((read) => read()).join(',') + '#' + values.join(',');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "classic for let creates a binding per iteration",
    expected: "0,1,2",
    actual: JSON.stringify("3,3,3"),
    body: `const reads = []; for (let index = 0; index < 3; index++) reads.push(() => index); return reads.map((read) => read()).join(',');`,
  },
  {
    name: "continue still creates the next iteration binding",
    expected: "0,1,2",
    actual: JSON.stringify("3,3,3"),
    body: `const reads = []; for (let index = 0; index < 3; index++) { reads.push(() => index); continue; } return reads.map((read) => read()).join(',');`,
  },
  {
    name: "break retains earlier iteration bindings",
    expected: "0,1",
    actual: JSON.stringify("1,1"),
    body: `const reads = []; for (let index = 0; index < 3; index++) { reads.push(() => index); if (index === 1) break; } return reads.map((read) => read()).join(',');`,
  },
  {
    name: "header initialization closure retains the initialization binding",
    expected: 0,
    actual: "2",
    body: `let read; for (let index = 0, capture = () => index; index < 2; index++) read = capture; return read();`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "for-of let creates independent iteration bindings",
    body: `const reads = []; for (let value of [1, 2, 3]) reads.push(() => value); return reads.map((read) => read()).join(',');`,
  },
  {
    name: "for-in let creates independent iteration bindings",
    body: `const reads = []; for (let key in { first: 1, second: 2 }) reads.push(() => key); return reads.map((read) => read()).join(',');`,
  },
  {
    name: "var loop headers intentionally share one binding",
    body: `const reads = []; for (var index = 0; index < 3; index++) reads.push(() => index); return reads.map((read) => read()).join(',');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it("known divergence: for-let captures in deferred reactions", () =>
  checkKnownDifferentialWitnesses(
    [
      {
        name: "deferred header capture",
        expected: "0,1,2",
        actual: JSON.stringify("3,3,3"),
        body: `const trace = []; for (let index = 0; index < 3; index++) Promise.resolve().then(() => trace.push(index)); return () => trace.join(',');`,
      },
    ],
    true,
  ));
