import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches native initialization, failed-super retries and partial instances, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const phases = ["none", "before-super", "base-field", "base-body", "child-field", "child-body"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const failure = phases[getRandom(phases.length)];
      const retry = getRandom(2) === 0;
      const argument = getRandom(2) === 0 ? "undefined" : String(getRandom(10));
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [], seen = [];
      let hasFailed = false;
      const step = (name, value) => { trace.push(name); if (name === '${failure}' && !hasFailed) { hasFailed = true; throw name; } return value; };
      class Base {
        base = step('base-field', ${getRandom(10)});
        constructor(value = step('base-default', ${getRandom(10)})) { seen.push(this); step('base-body'); this.parameter = value; }
      }
      class Child extends Base {
        child = step('child-field', ${getRandom(10)});
        constructor(value) {
          step('before-super');
          try { super(value); }
          catch (error) {
            trace.push('caught:' + error);
            try { trace.push('bound:' + this.base); } catch (error) { trace.push(error.name); }
            ${retry ? "super(value);" : "throw error;"}
          }
          step('child-body');
        }
      }
      let result;
      try { const instance = new Child(${argument}); result = instance.base + ':' + instance.parameter + ':' + instance.child; }
      catch (error) { result = typeof error === 'string' ? error : error.name; }
      return trace.join('|') + '#' + result + '#' + seen.map((instance) => instance.base + ':' + instance.parameter + ':' + instance.child).join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

describe.each([
  {
    name: "overriding a base field cannot suppress its exception",
    expected: "base-field|caught:stop",
    actual: JSON.stringify("child-field|accepted"),
    body: `const trace = []; const fail = () => { trace.push('base-field'); throw 'stop'; }; class Base { value = fail(); } class Child extends Base { value = (trace.push('child-field'), 2); } try { new Child(); trace.push('accepted'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "duplicate instance fields initialize in source order",
    expected: "first|second:2",
    actual: JSON.stringify("first:1"),
    body: `const trace = []; class Target { value = (trace.push('first'), 1); value = (trace.push('second'), 2); } const instance = new Target(); return trace.join('|') + ':' + instance.value;`,
  },
  {
    name: "duplicate static fields initialize in source order",
    body: `const trace = []; class Target { static value = (trace.push('first'), 1); static value = (trace.push('second'), 2); } return trace.join('|') + ':' + Target.value;`,
  },
  {
    name: "base and derived fields sharing a public name",
    expected: "base-field|base:1|child-field:2",
    actual: JSON.stringify("base:undefined|child-field:2"),
    body: `const trace = []; class Base { value = (trace.push('base-field'), 1); constructor() { trace.push('base:' + this.value); } } class Child extends Base { value = (trace.push('child-field'), 2); } const instance = new Child(); return trace.join('|') + ':' + instance.value;`,
  },
  {
    name: "class fields define rather than invoke inherited setters",
    body: `const trace = []; class Base { set value(value) { trace.push('setter:' + value); } } class Child extends Base { value = 7; } const instance = new Child(); return trace.join('|') + ':' + instance.value;`,
  },
  {
    name: "constructor assignments invoke inherited setters",
    expected: "setter:7:false",
    actual: JSON.stringify(":true"),
    body: `const trace = []; class Base { set value(value) { trace.push('setter:' + value); } } class Child extends Base { constructor() { super(); this.value = 7; } } const instance = new Child(); return trace.join('|') + ':' + Object.hasOwn(instance, 'value');`,
  },
  {
    name: "base fields precede parameter defaults",
    body: `const trace = []; class Base { value = (trace.push('field'), 1); constructor(value = (trace.push('parameter'), 2)) { trace.push('body'); } } new Base(); return trace.join('|');`,
  },
  {
    name: "a default arrow observes initialized derived this",
    body: `class Base {} class Child extends Base { constructor(read = () => this) { super(); this.same = read() === this; } } return new Child().same;`,
  },
  {
    name: "new.target identifies the most-derived class",
    expected: true,
    actual: "<boolean: === on dynamic values>",
    body: `class Base { constructor() { this.target = new.target; } } class Child extends Base {} return new Child().target === Child;`,
  },
  {
    name: "new.target is undefined in field initializers",
    expected: true,
    actual: "<boolean: === on dynamic values>",
    body: `class Base { target = new.target; } return new Base().target === undefined;`,
  },
  {
    name: "base replacement receives only derived fields",
    body: `const trace = []; const replacement = { marker: 'replacement' }; class Base { base = (trace.push('base'), 1); constructor() { return replacement; } } class Child extends Base { child = (trace.push('child'), 2); } const instance = new Child(); return (instance === replacement) + ':' + instance.base + ':' + instance.child + ':' + trace.join('|');`,
  },
  {
    name: "function replacements receive derived fields",
    expected: "true:7",
    actual: "branch(<string> | <string>)",
    body: `const replacement = () => 1; class Base { constructor() { return replacement; } } class Child extends Base { value = 7; } const instance = new Child(); return (instance === replacement) + ':' + instance.value;`,
  },
  {
    name: "class methods are inherited and non-enumerable",
    expected: "value:false",
    actual: JSON.stringify("method,value:true"),
    body: `class Example { value = 1; method() { return 2; } } const instance = new Example(); return Object.keys(instance).join(',') + ':' + Object.hasOwn(instance, 'method');`,
  },
  {
    name: "non-extensible replacements reject derived field definition",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `class Base { constructor() { return Object.preventExtensions({}); } } class Child extends Base { value = 1; } try { new Child(); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("class construction: $name", ({ name, body, expected, actual }) => {
  it(
    actual === undefined
      ? "matches native construction"
      : "known divergence: preserves initialization effects and results",
    () =>
      actual === undefined
        ? checkDifferentialCases([{ name, body }])
        : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
  );
});
