import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches initialized block, catch and nested closure environments, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const increment = getRandom(30);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      let value = ${initial};
      const readers = [() => value];
      {
        let value = ${initial + increment};
        readers.push(() => value);
        { const value = ${initial + increment + 1}; readers.push(() => value); }
        value += ${increment};
      }
      try { throw ${initial + increment + 2}; } catch (value) { readers.push(() => value); value += ${increment}; }
      value += ${increment};
      const make = () => { const read = () => local; const local = ${initial + 1}; return read; };
      readers.push(make());
      return readers.map((read) => read()).join(',') + '#' + value;
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "for-of right side is inside the iteration declaration temporal dead zone",
    expected: "ReferenceError",
    actual: JSON.stringify("body"),
    body: `const values = [1]; try { for (let values of values) { return 'body'; } return 'done'; } catch (error) { return error.name; }`,
  },
  {
    name: "typeof an undeclared identifier remains allowed",
    expected: "undefined",
    actual: '<string: typeof unknown(unbound identifier "absentLexicalProbe")>',
    body: `return typeof absentLexicalProbe;`,
  },
  {
    name: "block declarations do not leak after the block",
    expected: "undefined",
    actual: '<string: typeof unknown(unbound identifier "inner")>',
    body: `{ let inner = 1; } return typeof inner;`,
  },
  {
    name: "catch bindings do not leak after the handler",
    expected: "undefined",
    actual: '<string: typeof unknown(unbound identifier "inner")>',
    body: `try { throw 1; } catch (inner) {} return typeof inner;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "block let hides an outer binding before initialization",
    body: `const value = 99; try { { const result = value; let value = 1; return result; } } catch (error) { return error.name; }`,
  },
  {
    name: "typeof does not bypass a lexical temporal dead zone",
    body: `const value = 99; try { { const result = typeof value; let value = 1; return result; } } catch (error) { return error.name; }`,
  },
  {
    name: "closures observe an uninitialized captured binding",
    body: `const value = 99; try { { const read = () => value; const result = read(); let value = 1; return result; } } catch (error) { return error.name; }`,
  },
  {
    name: "self initialization does not read an outer value",
    body: `const value = 99; try { { let value = value; return value; } } catch (error) { return error.name; }`,
  },
  {
    name: "unreached declarations still create a temporal dead zone",
    body: `const run = () => { return typeof value; let value = 1; }; try { return run(); } catch (error) { return error.name; }`,
  },
  {
    name: "switch cases share the lexical declaration scope",
    body: `const value = 99; try { switch (0) { case 0: return typeof value; case 1: let value = 1; return value; } } catch (error) { return error.name; }`,
  },
  {
    name: "let declarations without an initializer become undefined",
    body: `const value = 99; { let value; return value; }`,
  },
  {
    name: "var hoisting shadows an outer binding with undefined",
    body: `const value = 99; const read = () => { return value; var value = 1; }; return read();`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
