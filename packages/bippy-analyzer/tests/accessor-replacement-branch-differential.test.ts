import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  checkGuardedCases,
  checkDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches replacement and accessor transitions in exhaustive boolean states, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 15; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(20);
      cases.push({
        name: `accessor/seed=${seed}/case=${index}`,
        body: `
      const run = (changesGetter, changesValue) => {
        let stored = ${initial};
        const original = () => stored;
        const replacement = () => stored + ${increment};
        const setter = (value) => { stored = value; };
        const target = {};
        Object.defineProperty(target, 'value', { get: original, set: setter, enumerable: true, configurable: true });
        if (changesGetter) Object.defineProperty(target, 'value', { get: replacement, set: setter, enumerable: true, configurable: true });
        if (changesValue) target.value = ${initial + increment + 1};
        return 'value:' + target.value + ':stored:' + stored;
      };
      if (first) { if (second) return run(true, true); return run(true, false); }
      if (second) return run(false, true);
      return run(false, false);
    `,
      });
      cases.push({
        name: `replacement/seed=${seed}/case=${index}`,
        body: `
      const run = (input, value) => { const trace = []; const result = input.replace(/a/g, (matched, offset) => { trace.push(offset); return String(value); }); return result + '#' + trace.join(','); };
      if (first) { if (second) return run('aba', ${initial}); return run('aa', ${increment}); }
      if (second) return run('ba', ${initial + increment});
      return run('bbb', ${initial});
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it("preserves conditional replacer throws and skips later matches", async () => {
  const testCase = {
    name: "conditional replacer throw",
    body: `let calls = 0; let outcome = 'ok'; try { 'aa'.replace(/a/g, () => { calls++; if (first) throw 'stop'; return 'x'; }); } catch (error) { outcome = error; } return outcome + ':' + calls;`,
  };
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});

it.each([
  {
    name: "conditional frozen accessor change",
    body: `const target = {}; Object.defineProperty(target, 'value', { get: () => 1 }); let outcome = 'ok'; try { if (first) Object.defineProperty(target, 'value', { get: () => 2 }); } catch (error) { outcome = error.name; } return outcome + ':' + target.value;`,
  },
  {
    name: "conditional configurable getter",
    body: `const target = {}; Object.defineProperty(target, 'value', { get: () => 1, configurable: true }); if (first) Object.defineProperty(target, 'value', { get: () => 2, configurable: true }); return String(target.value);`,
  },
])("preserves accessor branch: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});

it.each([false, true])("matches concrete configurable getter pin %s", (first) =>
  checkDifferentialCases([
    {
      name: `conditional configurable getter/${first}`,
      body: `const first = ${first}; const target = {}; Object.defineProperty(target, 'value', { get: () => 1, configurable: true }); if (first) Object.defineProperty(target, 'value', { get: () => 2, configurable: true }); return String(target.value);`,
    },
  ]),
);
