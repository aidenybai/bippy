import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  DifferentialMismatch,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native pure generator stepping, delegation and exhaustion, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const values = Array.from({ length: getRandom(6) }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const factory = { *items() { yield* ${JSON.stringify(values)}; return ${getRandom(20)}; } }; const iterator = factory.items(); const trace = []; for (let step = 0; step < ${values.length + 3}; step++) { const result = iterator.next(); trace.push(String(result.value) + ':' + result.done); } return trace.join('|');`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "creation is lazy",
    expected: "created|entered|paused",
    actual: JSON.stringify("entered|finished|created|paused"),
    body: `const trace = []; const factory = { *items() { trace.push('entered'); yield 1; trace.push('finished'); } }; const iterator = factory.items(); trace.push('created'); iterator.next(); trace.push('paused'); return trace.join('|');`,
  },
  {
    name: "next sends a value into yield",
    expected: "7:true",
    actual: "<string: + on dynamic values>",
    body: `const factory = { *items() { const received = yield 1; return received; } }; const iterator = factory.items(); iterator.next(); const result = iterator.next(7); return result.value + ':' + result.done;`,
  },
  {
    name: "return before starting does not enter finally",
    expected: "9:true|",
    actual: JSON.stringify("undefined:true|body,finally"),
    body: `const trace = []; const factory = { *items() { try { trace.push('body'); yield 1; } finally { trace.push('finally'); } } }; const iterator = factory.items(); const result = iterator.return(9); return result.value + ':' + result.done + '|' + trace.join(',');`,
  },
  {
    name: "return can suspend in a yielding finalizer",
    expected: "cleanup:false|9:true",
    actual: JSON.stringify("undefined:true|undefined:true"),
    body: `const factory = { *items() { try { yield 1; } finally { yield 'cleanup'; } } }; const iterator = factory.items(); iterator.next(); const closing = iterator.return(9); const finished = iterator.next(); return closing.value + ':' + closing.done + '|' + finished.value + ':' + finished.done;`,
  },
  {
    name: "throw resumes the generator catch block",
    expected: "caught:stop:false",
    actual: JSON.stringify("undefined:true"),
    body: `const factory = { *items() { try { yield 1; } catch (error) { yield 'caught:' + error; } } }; const iterator = factory.items(); iterator.next(); const result = iterator.throw('stop'); return result.value + ':' + result.done;`,
  },
  {
    name: "throw on a completed generator propagates the argument",
    expected: "stop",
    actual: JSON.stringify("swallowed"),
    body: `const iterator = ({ *items() {} }).items(); iterator.next(); try { iterator.throw('stop'); return 'swallowed'; } catch (error) { return error; }`,
  },
  {
    name: "next requires a generator receiver",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `const iterator = ({ *items() { yield 1; } }).items(); const next = iterator.next; try { next(); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "borrowed next advances the supplied generator",
    expected: "2:1",
    actual: JSON.stringify("1:undefined"),
    body: `const factory = { *items(value) { yield value; } }; const first = factory.items(1); const second = factory.items(2); const result = first.next.call(second); return result.value + ':' + first.next().value;`,
  },
])("known divergence: preserves $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

const cursorFactories = [
  { name: "generator", expression: "({ *items() { yield 10; yield 20; yield 30; } }).items()" },
  { name: "array values", expression: "[10, 20, 30].values()" },
  { name: "Map keys", expression: "new Map([[10, 'a'], [20, 'b'], [30, 'c']]).keys()" },
  { name: "Set values", expression: "new Set([10, 20, 30]).values()" },
];

const createCursorCase = (name: string, expression: string): DifferentialCase => ({
  name,
  body: `const iterator = ${expression}; if (first) iterator.next(); if (second) iterator.next(); return String(iterator.next().value);`,
});

const supportedCursorFactories = cursorFactories.filter(({ name }) => name !== "array values");

it.each(supportedCursorFactories)(
  "preserves $name cursor state across symbolic forks",
  ({ name, expression }) => checkSymbolicCases([createCursorCase(name, expression)]),
);

it.each(cursorFactories.filter(({ name }) => name === "array values"))(
  "known divergence: preserves $name cursor state across symbolic forks",
  async ({ name, expression }) => {
    const testCase = createCursorCase(name, expression);
    const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DifferentialMismatch);
    if (failure instanceof DifferentialMismatch)
      expect(failure.actual).toEqual([
        {
          ...testCase,
          expected: ["10", "20", "20", "30"],
          actual: "<string: String(unknown(call of undefined))>",
        },
      ]);
  },
);

it.each(supportedCursorFactories)(
  "matches every concrete pin for the same shared $name cursor",
  ({ name, expression }) => {
    const testCase = createCursorCase(name, expression);
    return checkDifferentialCases(
      [false, true].flatMap((first) =>
        [false, true].map((second) => ({
          name: `${name}/${first}/${second}`,
          body: `const first = ${first}; const second = ${second}; ${testCase.body}`,
        })),
      ),
    );
  },
);

it.each(differentialSeeds)(
  "matches native fork-local iterator allocation and consumption, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const values = [getRandom(10), 10 + getRandom(10), 20 + getRandom(10)];
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const sample = (count) => {
        const iterator = ({ *items() { yield* ${JSON.stringify(values)}; } }).items();
        for (let step = 0; step < count; step++) iterator.next();
        return String(iterator.next().value);
      };
      if (first) { if (second) return sample(2); return sample(1); }
      if (second) return sample(1);
      return sample(0);
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);
