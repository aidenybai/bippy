import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches ordinary promise identity and chained allocation, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const original = Promise.resolve(${getRandom(20)});
      const reused = Promise.resolve(original);
      const derived = original.then((value) => value + ${getRandom(20)});
      const other = original.then((value) => value);
      trace.push('identity:' + (original === reused) + ':' + (original === derived) + ':' + (derived === other));
      derived.then((value) => trace.push('derived:' + value));
      other.then((value) => trace.push('other:' + value));
      trace.push('sync');
      return () => trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases, true);
  },
);

it.each([
  {
    name: "Promise cannot be called without new",
    expected: "TypeError",
    actual: '"executor|accepted"',
    body: `const trace = []; try { Promise((resolve) => { trace.push('executor'); resolve(1); }); trace.push('accepted'); } catch (error) { trace.push(error.name); } return trace.join('|');`,
  },
  {
    name: "Promise.resolve reads a promise constructor before reusing it",
    expected: "constructor:true",
    actual: '":true"',
    body: `const trace = []; const original = Promise.resolve(7); Object.defineProperty(original, 'constructor', { get() { trace.push('constructor'); return Promise; } }); const result = Promise.resolve(original); return trace.join('|') + ':' + (result === original);`,
  },
  {
    name: "Promise.resolve does not reuse a differently branded constructor",
    expected: false,
    actual: "true",
    body: `const original = Promise.resolve(7); original.constructor = Object; return Promise.resolve(original) === original;`,
  },
  {
    name: "throwing constructor lookup makes Promise.resolve throw synchronously",
    expected: "constructor",
    actual: '"accepted"',
    body: `const original = Promise.resolve(7); Object.defineProperty(original, 'constructor', { get() { throw 'constructor'; } }); try { Promise.resolve(original); return 'accepted'; } catch (error) { return error; }`,
  },
  {
    name: "then reads species before registering its reaction",
    expected: "species|sync|handler",
    actual: '"sync|handler"',
    body: `const trace = []; const original = Promise.resolve(7); original.constructor = { get [Symbol.species]() { trace.push('species'); return Promise; } }; original.then(() => trace.push('handler')); trace.push('sync'); return () => trace.join('|');`,
    microtasks: true,
  },
  {
    name: "throwing species lookup prevents reaction registration",
    expected: "species|caught:species|sync",
    actual: '"accepted|sync|handler"',
    body: `const trace = []; const original = Promise.resolve(7); original.constructor = { get [Symbol.species]() { trace.push('species'); throw 'species'; } }; try { original.then(() => trace.push('handler')); trace.push('accepted'); } catch (error) { trace.push('caught:' + error); } trace.push('sync'); return () => trace.join('|');`,
    microtasks: true,
  },
  {
    name: "nonconstructor species throws before running a handler",
    expected: "TypeError|sync",
    actual: '"accepted|sync|handler"',
    body: `const trace = []; const original = Promise.resolve(7); original.constructor = { [Symbol.species]: () => 1 }; try { original.then(() => trace.push('handler')); trace.push('accepted'); } catch (error) { trace.push(error.name); } trace.push('sync'); return () => trace.join('|');`,
    microtasks: true,
  },
  {
    name: "Promise.all resolve lookup happens after defining its getter",
    expected: "defined|resolve|after",
    actual: '"resolve|defined|after"',
    body: `const trace = []; const nativeResolve = Promise.resolve; Object.defineProperty(Promise, 'resolve', { configurable: true, get() { trace.push('resolve'); return nativeResolve; } }); trace.push('defined'); Promise.all([1, 2]); trace.push('after'); return trace.join('|');`,
  },
  {
    name: "subclass resolve returns an instance of its receiver",
    expected: true,
    actual: "<boolean: instanceof on dynamic values>",
    body: `class Derived extends Promise {} return Derived.resolve(7) instanceof Derived;`,
  },
])("known divergence: $name", (testCase) =>
  checkKnownDifferentialWitnesses([testCase], testCase.microtasks ?? false),
);

it.each([
  {
    name: "Promise subclass instances preserve the subclass constructor",
    body: `class Derived extends Promise {} const promise = new Derived((resolve) => resolve(7)); return promise instanceof Derived;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
