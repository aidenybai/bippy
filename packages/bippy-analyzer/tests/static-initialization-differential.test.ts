import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches ordered static fields, blocks and captured locals, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const increment = 1 + getRandom(30);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = []; const readers = [];
      const step = (name, value) => { trace.push(name + ':' + value); return value; };
      class Target {
        static first = step('first', ${initial});
        static {
          trace.push('block:' + this.first);
          this.first += ${increment};
          let local = this.first; readers.push(() => local); local++;
        }
        static second = step('second', this.first + 1);
        static read() { return this.second; }
        static { const local = this.read(); readers.push(() => local); trace.push('last:' + local); }
      }
      return trace.join('|') + '#' + Target.first + ':' + Target.read() + '#' + readers.map((read) => read()).join(',');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each(["none", "first", "block", "second"])(
  "preserves static initialization completion at %s",
  (failure) =>
    checkDifferentialCases([
      {
        name: `failure=${failure}`,
        body: `
    const trace = [];
    const step = (name) => { trace.push(name); if (name === '${failure}') throw name; return name; };
    try {
      class Target {
        static first = step('first');
        static { try { step('block'); } finally { trace.push('finally'); } }
        static second = step('second');
      }
      trace.push('completed');
    } catch (error) { trace.push('caught:' + error); }
    return trace.join('|');
  `,
      },
    ]),
);

it.each([
  {
    name: "all computed keys precede every static initializer",
    body: `const trace = []; const key = (name) => { trace.push('key:' + name); return name; }; class Target { static [key('first')] = (trace.push('first'), 1); [key('instance')] = 2; static { trace.push('block'); } static [key('last')] = (trace.push('last'), 3); } return trace.join('|');`,
  },
  {
    name: "throwing computed keys prevent every static initializer",
    body: `const trace = []; const key = () => { trace.push('key'); throw 'key'; }; try { class Target { static first = (trace.push('first'), 1); [key()] = 2; } trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "static block let bindings do not shadow later fields",
    body: `const value = 9; class Target { static { let value = 1; } static result = value; } return Target.result;`,
  },
  {
    name: "later static fields exist only after their initialization",
    body: `class Target { static first = this.second; static second = 2; } return String(Target.first) + ':' + Target.second;`,
  },
  {
    name: "static method definitions are available to earlier fields",
    body: `class Target { static value = this.read(); static read() { return 7; } } return Target.value;`,
  },
  {
    name: "static field self-reference sees the class name binding",
    body: `const Target = class Named { static self = Named; }; return Target.self === Target;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it("known divergence: static blocks have separate var environments", () =>
  checkKnownDifferentialWitnesses([
    {
      name: "static blocks have separate var environments",
      expected: 9,
      actual: "1",
      body: `const value = 9; class Target { static { var value = 1; } static result = value; } return Target.result;`,
    },
  ]));
