import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches ordered catch defaults and simple catch-var shadowing, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 20; index++) {
      const initial = getRandom(30);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body:
          index % 2 === 0
            ? `
      var value = ${initial}; let read;
      try { throw ${initial + 1}; } catch (value) { read = () => value; var value = ${initial + increment}; }
      return value + ':' + read();
    `
            : `
      try { throw {}; } catch ({ first = ${initial}, second = first + ${increment} }) { const read = () => second; second++; return first + ':' + read(); }
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

const cases = [
  {
    name: "switch discriminants precede the switch lexical scope",
    body: `const key = 7; switch (key) { case 7: let key = 9; return key; }`,
  },
  {
    name: "discriminant closures retain the outer environment",
    body: `const key = 7; let read; switch ((read = () => key, 0)) { case 0: let key = 9; return read(); }`,
  },
  {
    name: "case expression closures capture the switch environment",
    expected: 9,
    actual: "7",
    body: `const key = 7; let read; switch (0) { case (read = () => key, 0): let key = 9; return read(); }`,
  },
  {
    name: "case expressions see uninitialized switch-local bindings",
    body: `const key = 7; try { switch (7) { case key: let key = 9; return 'matched'; } } catch (error) { return error.name; }`,
  },
  {
    name: "catch self defaults see their own uninitialized binding",
    expected: "ReferenceError",
    actual: "99",
    body: `const value = 99; try { try { throw {}; } catch ({ value = value }) { return value; } } catch (error) { return error.name; }`,
  },
  {
    name: "catch defaults cannot read later catch bindings",
    expected: "ReferenceError",
    actual: "99",
    body: `const value = 99; try { try { throw {}; } catch ({ first = value, value = 7 }) { return first; } } catch (error) { return error.name; }`,
  },
  {
    name: "catch default closures cannot capture later handler-body bindings",
    expected: 99,
    actual: "7",
    body: `const value = 99; try { throw {}; } catch ({ read = () => value }) { let value = 7; return read(); }`,
  },
  {
    name: "handler-body closures do capture handler-body bindings",
    body: `const value = 99; try { throw {}; } catch ({ unused = 1 }) { let value = 7; const read = () => value; return read(); }`,
  },
  {
    name: "throwing catch defaults skip the body and run the finalizer",
    expected: "default|finally|outer:binding",
    actual: '"default|body|finally"',
    body: `const trace = []; const fail = () => { trace.push('default'); throw 'binding'; }; try { try { throw {}; } catch ({ value = fail() }) { trace.push('body'); } finally { trace.push('finally'); } } catch (error) { trace.push('outer:' + error); } return trace.join('|');`,
  },
  {
    name: "throwing catch getters skip the body and run the finalizer",
    expected: "get|finally|outer:binding",
    actual: '"get|body|finally"',
    body: `const trace = []; const thrown = { get value() { trace.push('get'); throw 'binding'; } }; try { try { throw thrown; } catch ({ value }) { trace.push('body'); } finally { trace.push('finally'); } } catch (error) { trace.push('outer:' + error); } return trace.join('|');`,
  },
  {
    name: "null catch destructuring propagates its TypeError",
    expected: "finally|TypeError",
    actual: '"body|finally"',
    body: `const trace = []; try { try { throw null; } catch ({ value }) { trace.push('body'); } finally { trace.push('finally'); } } catch (error) { trace.push(error.name); } return trace.join('|');`,
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
