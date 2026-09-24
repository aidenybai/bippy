import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches bound argument order, retained receivers and invocation forms, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const initial = getRandom(20);
      const leading = Array.from({ length: getRandom(4) }, () => getRandom(20));
      const middle = Array.from({ length: getRandom(4) }, () => getRandom(20));
      const trailing = Array.from({ length: getRandom(4) }, () => getRandom(20));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const receiver = { value: ${initial} };
      const other = { value: 1000 };
      const owner = { invoke(...values) { trace.push(this.value + ':' + values.join(',')); return this.value + values.reduce((total, value) => total + value, 0); } };
      const bound = owner.invoke.bind(receiver, ...[${leading.join(",")}]);
      const rebound = bound.bind(other, ...[${middle.join(",")}]);
      const trailing = [${trailing.join(",")}];
      const results = [rebound(...trailing)];
      receiver.value += ${getRandom(10)};
      results.push(rebound.call(other, ...trailing));
      results.push(rebound.apply(other, trailing));
      return results.join(',') + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "class call without construction throws",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `class Target {} try { Target.call(null); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "binding a class creates a distinct function",
    expected: false,
    actual: "true",
    body: `class Target {} return Target.bind(null) === Target;`,
  },
  {
    name: "bound class constructor receives leading arguments",
    expected: "7",
    actual: JSON.stringify(""),
    body: `const trace = []; class Target { constructor(value) { trace.push(value); } } const Bound = Target.bind(null, 7); new Bound(9); return trace.join(',');`,
  },
  {
    name: "foreign newTarget still invokes the target constructor",
    expected: "target",
    actual: JSON.stringify(""),
    body: `const trace = []; class Target { constructor() { trace.push('target'); } } class Alternate { constructor() { trace.push('alternate'); } } Reflect.construct(Target, [], Alternate); return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "separate bind evaluations have distinct identity",
    body: `const target = () => 1; return target.bind(null) === target.bind(null);`,
  },
  {
    name: "apply reads array-like length and indices without iterating",
    body: `const trace = []; const args = { get length() { trace.push('length'); return 2; }, get 0() { trace.push('0'); return 1; }, get 1() { trace.push('1'); return 2; }, [Symbol.iterator]() { throw 'iterator'; } }; const target = () => trace.push('body'); target.apply(null, args); return trace.join('|');`,
  },
  {
    name: "apply stops at a throwing array-like getter",
    body: `const trace = []; const args = { length: 2, get 0() { trace.push('0'); throw 'stop'; }, get 1() { trace.push('1'); return 2; } }; const target = () => trace.push('body'); try { target.apply(null, args); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "Reflect.apply reads ordinary array-like arguments",
    body: `const trace = []; const args = { get length() { trace.push('length'); return 1; }, get 0() { trace.push('0'); return 1; } }; Reflect.apply(() => trace.push('body'), null, args); return trace.join('|');`,
  },
  {
    name: "Reflect.apply rejects an absent argument list",
    body: `try { Reflect.apply(() => 1, null); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "apply accepts a null argument list as empty",
    body: `const target = (...values) => values.length; return target.apply(null, null);`,
  },
  {
    name: "apply accepts an omitted argument list as empty",
    body: `const target = (...values) => values.length; return target.apply(null);`,
  },
  {
    name: "Reflect.apply executes a bound callback exactly once",
    body: `let count = 0; const owner = { invoke() { count++; } }; const bound = owner.invoke.bind(owner); Reflect.apply(bound, null, []); return count;`,
  },
  {
    name: "bound functions retain an undefined receiver after rebinding",
    body: `const owner = { target() { return this === undefined; } }; return owner.target.bind(undefined).bind({}) ();`,
  },
  {
    name: "same-target Reflect.construct runs the constructor",
    body: `const trace = []; class Target { constructor(value) { trace.push(value); } } Reflect.construct(Target, [7], Target); return trace.join(',');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
