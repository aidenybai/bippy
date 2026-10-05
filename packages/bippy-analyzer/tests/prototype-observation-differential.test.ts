import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches ordinary class constructor and instance prototype observations, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(30);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      class Base { constructor(value) { this.value = value; } read() { return this.value; } }
      class Child extends Base {}
      const target = new Child(${initial});
      return [Object.getPrototypeOf(Child) === Base, Object.getPrototypeOf(Child.prototype) === Base.prototype, Object.getPrototypeOf(target) === Child.prototype, target instanceof Child, target instanceof Base, target.read()].join(':');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const cases = [
  {
    name: "ordinary base constructors inherit Function.prototype",
    body: `class Base {} return Object.getPrototypeOf(Base) === Function.prototype;`,
  },
  {
    name: "ordinary base prototypes inherit Object.prototype",
    body: `class Base {} return Object.getPrototypeOf(Base.prototype) === Object.prototype;`,
  },
  {
    name: "extends-null prototypes have a null parent",
    expected: true,
    actual: "false",
    body: `class Child extends null {} return Object.getPrototypeOf(Child.prototype) === null;`,
  },
  {
    name: "extends-null constructors still inherit Function.prototype",
    expected: true,
    actual: "false",
    body: `class Child extends null {} return Object.getPrototypeOf(Child) === Function.prototype;`,
  },
  {
    name: "derived prototypes do not own inherited methods",
    expected: false,
    actual: "true",
    body: `class Base { read() { return 7; } } class Child extends Base {} return Object.hasOwn(Child.prototype, 'read');`,
  },
  {
    name: "instances do not own prototype methods",
    expected: false,
    actual: "true",
    body: `class Base { read() { return 7; } } return Object.hasOwn(new Base(), 'read');`,
  },
  {
    name: "prototype inspection does not initialize instance fields",
    body: `const trace = []; class Base { value = trace.push('field'); } const prototype = Base.prototype; return Object.hasOwn(prototype, 'value') + ':' + trace.join('|');`,
  },
  {
    name: "explicit class-prototype objects satisfy instanceof",
    expected: true,
    actual: "false",
    body: `class Base {} return Object.create(Base.prototype) instanceof Base;`,
  },
  {
    name: "explicit derived prototypes satisfy base instanceof",
    expected: true,
    actual: "false",
    body: `class Base {} class Child extends Base {} return Object.create(Child.prototype) instanceof Base;`,
  },
  {
    name: "class prototype isPrototypeOf observes explicit links",
    expected: true,
    actual: "false",
    body: `class Base {} const target = Object.create(Base.prototype); return Base.prototype.isPrototypeOf(target);`,
  },
  {
    name: "explicit links remain visible through getPrototypeOf",
    body: `class Base {} const target = Object.create(Base.prototype); return Object.getPrototypeOf(target) === Base.prototype;`,
  },
  {
    name: "explicit prototype objects inherit methods without construction",
    body: `class Base { read() { return 7; } } return Object.create(Base.prototype).read();`,
  },
  {
    name: "ordinary function prototype replacement applies to later instances",
    body: `const Base = function () {}; const before = new Base(); const original = Base.prototype; const replacement = {}; Base.prototype = replacement; const after = new Base(); return [Object.getPrototypeOf(before) === original, Object.getPrototypeOf(after) === replacement, before instanceof Base, after instanceof Base].join(':');`,
  },
];

it.each(
  cases.map((testCase) => ({
    label: `${testCase.actual === undefined ? "" : "known divergence: "}${testCase.name}`,
    testCase,
  })),
)("$label", ({ testCase }) => {
  if (testCase.actual !== undefined) {
    const { name, body, expected, actual } = testCase;
    return checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
  }
  return checkDifferentialCases([testCase]);
});
