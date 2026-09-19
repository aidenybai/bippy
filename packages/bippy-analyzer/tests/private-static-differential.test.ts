import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches independent private static counter histories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const statements = Array.from(
        { length: 6 },
        (_value, step) =>
          `trace.push(${step % 2 === 0 ? "First" : "Second"}.add(${getRandom(11) - 5}));`,
      );
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const create = (initial) => class Counter {
        static #value = initial;
        static add(value) { this.#value += value; return this.#value; }
        static read() { return this.#value; }
      };
      const First = create(${initial}); const Second = create(${initial + 1}); const trace = [];
      ${statements.join("\n")}
      return trace.join(',') + '#' + First.read() + ':' + Second.read();
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "a derived constructor does not inherit a private static brand",
    expected: "TypeError",
    actual: "7",
    body: `class Base { static #value = 7; static read() { return this.#value; } } class Child extends Base {} try { return Child.read(); } catch (error) { return error.name; }`,
  },
  {
    name: "same-spelled private static fields do not grant the base brand",
    expected: "TypeError",
    actual: "9",
    body: `class Base { static #value = 7; static read() { return this.#value; } } class Child extends Base { static #value = 9; } try { return Child.read(); } catch (error) { return error.name; }`,
  },
  {
    name: "borrowed readers reject separately evaluated static brands",
    expected: "TypeError",
    actual: "7",
    body: `const create = () => class { static #value = 7; static read() { return this.#value; } }; const First = create(); const Second = create(); try { return First.read.call(Second); } catch (error) { return error.name; }`,
  },
  {
    name: "public strings cannot forge a private static brand",
    expected: "TypeError",
    actual: "99",
    body: `class Target { static #value = 7; static read() { return this.#value; } } try { return Target.read.call({ '#value': 99 }); } catch (error) { return error.name; }`,
  },
  {
    name: "public string assignments cannot change private static storage",
    expected: 7,
    actual: "99",
    body: `class Target { static #value = 7; static read() { return this.#value; } } Target['#value'] = 99; return Target.read();`,
  },
  {
    name: "private static storage is absent from string lookup",
    expected: "undefined",
    actual: '"7"',
    body: `class Target { static #value = 7; } return String(Target['#value']);`,
  },
  {
    name: "static private field access before initialization throws",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { class Target { static first = this.#later; static #later = 7; } return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "a proxy around a class does not acquire its private brand",
    expected: "TypeError",
    actual: "7",
    body: `class Target { static #value = 7; static read() { return this.#value; } } const proxy = new Proxy(Target, {}); try { return proxy.read(); } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "static private methods are installed before field initialization",
    body: `class Target { static first = this.#read(); static #read() { return 7; } } return Target.first;`,
  },
  {
    name: "lexically named private access works from an inherited method",
    body: `class Base { static #value = 7; static read() { return Base.#value; } } class Child extends Base {} return Child.read();`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
