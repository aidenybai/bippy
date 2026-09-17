import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches fresh classes with dynamically selected bases, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(20);
      const extra = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      class FirstBase { constructor(value) { trace.push('first'); this.base = value + ${initial}; } read() { return this.base; } }
      class SecondBase { constructor(value) { trace.push('second'); this.base = value + ${initial + 40}; } read() { return this.base; } }
      const create = (Base) => class extends Base { extra = ${extra}; read() { return super.read() + this.extra; } };
      const First = create(${index % 2 === 0 ? "FirstBase" : "SecondBase"});
      const Second = create(${index % 2 === 0 ? "SecondBase" : "FirstBase"});
      const first = new First(3); const second = new Second(3);
      return trace.join('|') + ':' + first.read() + ':' + second.read() + ':' + (First !== Second);
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "heritage captures the selected base before its variable changes",
    body: `class First { read() { return 7; } } class Second { read() { return 9; } } let Base = First; class Child extends Base {} Base = Second; return new Child().read();`,
  },
  {
    name: "an explicit extends-null constructor may return an object",
    body: `class Child extends null { constructor() { return { value: 7 }; } } return new Child().value;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "an implicit extends-null constructor cannot call null",
    expected: "TypeError",
    actual: '"accepted"',
    body: `class Child extends null {} try { new Child(); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "heritage definition observes superclass prototype lookup",
    expected: "key|prototype|static",
    actual: '"key|static"',
    body: `const trace = []; const Base = new Proxy(class {}, { get(target, key) { trace.push(String(key)); return target[key]; } }); class Child extends Base { [trace.push('key')]() {} static value = trace.push('static'); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

const bases = [
  "7",
  "undefined",
  "() => {}",
  "async () => {}",
  "function* () {}",
  "async function* () {}",
  "{}",
  "[]",
  "Symbol('base')",
  "3n",
  "null",
  "function () {}",
  "class {}",
];
const cases = bases.map((base) => {
  const isKnown = !["null", "function () {}", "class {}"].includes(base);
  const name = `heritage/${base}`;
  return {
    name,
    label: `${isKnown ? "known divergence: " : ""}${name}`,
    isKnown,
    body: `const trace = []; const getBase = () => { trace.push('base'); return (${base}); }; try { class Child extends getBase() { [trace.push('key')]() {} static value = trace.push('static'); } trace.push('after'); } catch (error) { trace.push(error.name); } return trace.join('|');`,
  };
});

it.each(cases)("$label", ({ name, body, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([
        { name, body, expected: "base|key|TypeError", actual: '"base|key|static|after"' },
      ])
    : checkDifferentialCases([{ name, body }]),
);
