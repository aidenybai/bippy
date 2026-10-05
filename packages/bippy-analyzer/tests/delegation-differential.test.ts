import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches bounded pure nested delegation and completion values, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 40; index++) {
      const leading = Array.from({ length: getRandom(6) }, () => getRandom(20));
      const trailing = Array.from({ length: getRandom(6) }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const factory = { *inner() { yield* [${leading.join(",")}]; return 99; }, *outer() { yield 'start'; yield* this.inner(); yield* [${trailing.join(",")}]; yield 'end'; return 'finished'; } }; const iterator = factory.outer(); const trace = []; for (let index = 0; index < ${leading.length + trailing.length + 5}; index++) { const result = iterator.next(index); trace.push(String(result.value) + ':' + result.done); } return trace.join('|');`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "yield-star returns the delegate completion value",
    expected: 7,
    actual: "unknown(value sent to the generator)",
    body: `const factory = { *inner() { yield 1; return 7; }, *outer() { return yield* this.inner(); } }; const iterator = factory.outer(); iterator.next(); return iterator.next().value;`,
  },
  {
    name: "delegation forwards sent values to next",
    expected: "next:7#end:true",
    actual: JSON.stringify("#end:true"),
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next(value) { trace.push('next:' + value); return { value: 1, done: position++ > 0 }; } }; const iterator = ({ *outer() { yield* delegate; return 'end'; } }).outer(); iterator.next(); trace.length = 0; const result = iterator.next(7); return trace.join('|') + '#' + result.value + ':' + result.done;`,
  },
  {
    name: "delegation forwards return and uses its completion value",
    expected: "return:9#10:true",
    actual: JSON.stringify("#end:true"),
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next() { return { value: 1, done: position++ > 0 }; }, return(value) { trace.push('return:' + value); return { value: value + 1, done: true }; } }; const iterator = ({ *outer() { yield* delegate; return 'end'; } }).outer(); iterator.next(); trace.length = 0; const result = iterator.return(9); return trace.join('|') + '#' + result.value + ':' + result.done;`,
  },
  {
    name: "delegation forwards throw and can yield its result",
    expected: "throw:stop#7:false",
    actual: JSON.stringify("#end:true"),
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next() { return { value: 1, done: position++ > 0 }; }, throw(value) { trace.push('throw:' + value); return { value: 7, done: false }; } }; const iterator = ({ *outer() { yield* delegate; return 'end'; } }).outer(); iterator.next(); trace.length = 0; const result = iterator.throw('stop'); return trace.join('|') + '#' + result.value + ':' + result.done;`,
  },
  {
    name: "missing delegate throw closes before raising TypeError",
    expected: "return:0|caught:TypeError",
    actual: JSON.stringify("accepted"),
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next() { return { value: 1, done: position++ > 0 }; }, return(...values) { trace.push('return:' + values.length); return { done: true }; } }; const iterator = ({ *outer() { yield* delegate; } }).outer(); iterator.next(); trace.length = 0; try { iterator.throw('stop'); trace.push('accepted'); } catch (error) { trace.push('caught:' + error.name); } return trace.join('|');`,
  },
  {
    name: "yield-star sends one undefined argument to initial next",
    expected: "1,1",
    actual: JSON.stringify("0,0"),
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next(...values) { trace.push(values.length); return { value: 1, done: position++ > 0 }; } }; Array.from(({ *outer() { yield* delegate; } }).outer()); return trace.join(',');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "plain iteration calls next without arguments",
    body: `const trace = []; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next(...values) { trace.push(values.length); return { value: 1, done: position++ > 0 }; } }; Array.from(delegate); return trace.join(',');`,
  },
  {
    name: "string delegation iterates Unicode code points",
    body: `return Array.from(({ *outer() { yield* '😀a'; } }).outer()).join(':');`,
  },
  {
    name: "delegation retains the original next method",
    body: `let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next() { position++; if (position === 1) this.next = () => { throw 'replacement'; }; return { value: position, done: position > 2 }; } }; const result = Array.from(({ *outer() { yield* delegate; } }).outer()); return result.join(',') + ':' + position;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it("known divergence: delegated iterator result object identity", () =>
  checkKnownDifferentialWitnesses([
    {
      name: "delegated result identity and extra properties",
      expected: "true:7",
      actual: JSON.stringify("false:undefined"),
      body: `const result = { value: 1, done: false, extra: 7 }; let position = 0; const delegate = { [Symbol.iterator]() { return this; }, next() { return position++ === 0 ? result : { done: true }; } }; const iterator = ({ *outer() { yield* delegate; } }).outer(); const forwarded = iterator.next(); return (forwarded === result) + ':' + forwarded.extra;`,
    },
  ]));
