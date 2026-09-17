import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches forward function calls and per-block captures, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = 20 + getRandom(20);
      const increment = 1 + getRandom(10);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body:
          index % 2 === 0
            ? `
      const readers = [];
      for (let index = 0; index < 3; index++) {
        let value = ${initial} + index; readers.push(read); value += ${increment};
        function read() { return value; }
      }
      return readers.map((read) => read()).join(',');
    `
            : `
      return even(${index % 7});
      function even(count) { return count === 0 ? ${initial} : odd(count - 1); }
      function odd(count) { return count === 0 ? ${increment} : even(count - 1); }
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const cases = [
  {
    name: "a block function shadows an outer function before its declaration",
    body: `const read = () => 99; { return read(); function read() { return 7; } }`,
  },
  {
    name: "strict block functions do not replace outer bindings",
    body: `let read = () => 99; { function read() { return 7; } read(); } return read();`,
  },
  {
    name: "a body function declaration replaces a parameter binding",
    body: `const run = (read) => { return read(); function read() { return 7; } }; return run(() => 99);`,
  },
  {
    name: "the last duplicate function declaration wins at entry",
    body: `return read(); function read() { return 1; } function read() { return 7; }`,
  },
  {
    name: "a var declaration without an initializer preserves a hoisted function",
    expected: "function:function",
    actual: '"function:undefined"',
    body: `const before = typeof read; var read; return before + ':' + typeof read; function read() { return 7; }`,
  },
  {
    name: "a nested bare var preserves a hoisted function in the owning scope",
    body: `function read() { return 7; } { var read; } return read();`,
  },
  {
    name: "a later var initializer overwrites a hoisted function",
    body: `const before = read(); var read = 9; return before + ':' + read; function read() { return 7; }`,
  },
  {
    name: "a switch function exists before the declaring case is reached",
    expected: 7,
    actual: 'unknown(call of unbound identifier "read")',
    body: `switch (0) { case 0: return read(); case 1: function read() { return 7; } }`,
  },
  {
    name: "const writes throw rather than replace the binding",
    expected: "TypeError:7",
    actual: '"accepted:9"',
    body: `const value = 7; try { value = 9; return 'accepted:' + value; } catch (error) { return error.name + ':' + value; }`,
  },
  {
    name: "class declarations shadow outer values before initialization",
    expected: "ReferenceError",
    actual: "99",
    body: `const Target = 99; try { { const result = Target; class Target {} return result; } } catch (error) { return error.name; }`,
  },
  {
    name: "a class name is uninitialized in its own heritage expression",
    expected: "ReferenceError",
    actual: '"accepted"',
    body: `const Target = class {}; try { const Created = class Target extends Target {}; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "computed class keys precede class-name initialization",
    expected: "ReferenceError",
    actual: '"accepted"',
    body: `const Target = 99; try { class Target { [Target]() {} } return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "class methods retain the inner name after the outer declaration changes",
    body: `class Target { static read() { return Target; } } const Original = Target; Target = 7; return Original.read() === Original;`,
  },
  {
    name: "class declaration inner names cannot be assigned",
    expected: "TypeError",
    actual: '"accepted"',
    body: `class Target { static write() { Target = 7; } } try { Target.write(); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "named class expressions retain their own name",
    body: `let Target = 99; const Created = class Target { static read() { return Target; } }; Target = 7; return Created.read() === Created;`,
  },
  {
    name: "named class expression bindings do not overwrite outer names",
    body: `let Target = 99; const Created = class Target {}; return Target;`,
  },
  {
    name: "strict named function expression bindings cannot be assigned",
    expected: "TypeError",
    actual: '"accepted"',
    body: `const read = function inner() { inner = 7; }; try { read(); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "named function expression self references survive outer reassignment",
    body: `let read = function inner() { return inner; }; const original = read; read = 7; return original() === original;`,
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
