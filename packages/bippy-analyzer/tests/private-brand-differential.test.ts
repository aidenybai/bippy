import { it } from "vite-plus/test";
import {
  checkKnownDifferentialWitnesses,
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "private brand checks evaluate the right-hand side",
    expected: "rhs",
    actual: JSON.stringify(""),
    body: `const trace = []; const read = () => { trace.push('rhs'); return {}; }; class Secret { #value; static check() { return #value in read(); } } Secret.check(); return trace.join('|');`,
  },
  {
    name: "private brand checks propagate right-hand exceptions",
    expected: "caught:stop",
    actual: JSON.stringify("accepted"),
    body: `const fail = () => { throw 'stop'; }; class Secret { #value; static check() { return #value in fail(); } } try { Secret.check(); return 'accepted'; } catch (error) { return 'caught:' + error; }`,
  },
  {
    name: "private names are not public string properties",
    expected: "undefined:",
    actual: JSON.stringify("7:#value"),
    body: `class Secret { #value = 7; } const instance = new Secret(); return String(instance['#value']) + ':' + Object.keys(instance).join(',');`,
  },
  {
    name: "a public string cannot forge a private brand",
    expected: "TypeError",
    actual: JSON.stringify("value:99"),
    body: `class Secret { #value = 7; read() { return this.#value; } } const read = new Secret().read; try { return 'value:' + read.call({ '#value': 99 }); } catch (error) { return error.name; }`,
  },
  {
    name: "a public string write cannot mutate a private field",
    expected: 7,
    actual: "99",
    body: `class Secret { #value = 7; read() { return this.#value; } } const instance = new Secret(); instance['#value'] = 99; return instance.read();`,
  },
  {
    name: "deleting a public string cannot delete a private field",
    expected: 7,
    actual: "undefined",
    body: `class Secret { #value = 7; read() { return this.#value; } } const instance = new Secret(); delete instance['#value']; return instance.read();`,
  },
  {
    name: "same-spelled private fields in a hierarchy remain distinct",
    expected: "1:2",
    actual: JSON.stringify("2:2"),
    body: `class Base { #value = 1; base() { return this.#value; } } class Child extends Base { #value = 2; child() { return this.#value; } } const instance = new Child(); return instance.base() + ':' + instance.child();`,
  },
  {
    name: "separate evaluations of a class create fresh brands",
    expected: "TypeError",
    actual: "7",
    body: `const create = () => class { #value = 7; read() { return this.#value; } }; const First = create(); const Second = create(); try { return new First().read.call(new Second()); } catch (error) { return error.name; }`,
  },
  {
    name: "a proxy does not inherit the target private brand",
    expected: "TypeError",
    actual: "7",
    body: `class Secret { #value = 7; read() { return this.#value; } } const proxy = new Proxy(new Secret(), {}); try { return proxy.read(); } catch (error) { return error.name; }`,
  },
  {
    name: "private access before its field is initialized throws",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `class Secret { first = this.#later; #later = 7; } try { new Secret(); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "a replacement object can receive a private brand only once",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `class Base { constructor(value) { return value; } } class Stamp extends Base { #value = 7; } const target = {}; new Stamp(target); try { new Stamp(target); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "private brand checks distinguish branded and lookalike objects",
    expected: "true:false",
    actual: "<string: + on dynamic values>",
    body: `class Secret { #value = 7; static has(value) { return #value in value; } } return Secret.has(new Secret()) + ':' + Secret.has({ '#value': 7 });`,
  },
])("known divergence: enforces $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "public field",
    declaration: "value = 0;",
    write: (value: number) => `instance.value = ${value};`,
    read: "instance.value",
  },
  {
    name: "private field",
    declaration: "#value = 0; set(value) { this.#value = value; } read() { return this.#value; }",
    write: (value: number) => `instance.set(${value});`,
    read: "instance.read()",
  },
])("journals $name writes independently of sibling forks", ({ name, declaration, write, read }) =>
  checkSymbolicCases([
    {
      name,
      body: `class Counter { ${declaration} } const instance = new Counter(); if (first) { ${write(1)} } if (second) { ${write(2)} } return String(${read});`,
    },
  ]),
);

it.each(differentialSeeds)(
  "matches native independent private-instance writes under exhaustive forks, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 15; index++) {
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      class Counter { #value = ${getRandom(10)}; set(value) { this.#value = value; } read() { return this.#value; } }
      const left = new Counter(), right = new Counter();
      if (first) left.set(${10 + getRandom(10)});
      if (second) right.set(${20 + getRandom(10)});
      return left.read() + ':' + right.read();
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);
