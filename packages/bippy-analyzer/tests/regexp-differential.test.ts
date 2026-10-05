import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  DifferentialMismatch,
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches bounded native regexp cursor histories, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const patterns = ["/a/g", "/a/y", "/a*/g", "/(?:)/gu", "/(a)?b/g", "/(?<letter>a)/g"];
    const inputs = ["", "aba", "baab", "😀a😀", "bbbb"];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 50; index++) {
      const statements: string[] = [];
      for (let step = 0; step < 8; step++) {
        statements.push(`pattern.lastIndex = ${getRandom(7)};`);
        const input = JSON.stringify(inputs[getRandom(inputs.length)]);
        statements.push(
          getRandom(2) === 0
            ? `matched = pattern.exec(${input}); trace.push((matched ? matched.index + ':' + matched[0] + ':' + String(matched[1]) : 'none') + '/' + pattern.lastIndex);`
            : `trace.push(pattern.test(${input}) + '/' + pattern.lastIndex);`,
        );
        statements.push(
          `matched = pattern.exec(${input}); trace.push((matched ? matched.index + ':' + matched[0] : 'none') + '/' + pattern.lastIndex);`,
        );
      }
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `const pattern = ${patterns[index % patterns.length]}; const trace = []; let matched; ${statements.join("\n")} return trace.join('|');`,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "global match resets the original cursor",
    expected: "a,a:0",
    actual: JSON.stringify("a,a:2"),
    body: `const pattern = /a/g; pattern.lastIndex = 2; const result = 'aba'.match(pattern); return result.join(',') + ':' + pattern.lastIndex;`,
  },
  {
    name: "matchAll starts at the original cursor without changing it",
    expected: "2:2",
    actual: JSON.stringify("0,2:2"),
    body: `const pattern = /a/g; pattern.lastIndex = 2; const result = Array.from('aba'.matchAll(pattern)); return result.map((match) => match.index).join(',') + ':' + pattern.lastIndex;`,
  },
  {
    name: "sticky string matching starts at lastIndex",
    expected: "1:2",
    actual: JSON.stringify("none:1"),
    body: `const pattern = /a/y; pattern.lastIndex = 1; const result = 'ba'.match(pattern); return (result ? result.index : 'none') + ':' + pattern.lastIndex;`,
  },
  {
    name: "global replacement updates the original cursor",
    expected: "xbx:0",
    actual: JSON.stringify("xbx:2"),
    body: `const pattern = /a/g; pattern.lastIndex = 2; const result = 'aba'.replace(pattern, 'x'); return result + ':' + pattern.lastIndex;`,
  },
  {
    name: "indexed exec exposes capture indices",
    expected: true,
    actual: "false",
    body: `return Array.isArray(/(a)/d.exec('a').indices);`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "split preserves the original regexp cursor",
    body: `const pattern = /a/g; pattern.lastIndex = 2; return 'aba'.split(pattern).join(',') + ':' + pattern.lastIndex;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it("known divergence: regexp cursor mutation crosses an early return branch", async () => {
  const testCase = {
    name: "early return regexp cursor",
    body: `const pattern = /a/g; if (first) { pattern.test('aba'); return 'changed'; } const result = pattern.exec('aba'); return 'index:' + result.index;`,
  };
  const failure: unknown = await checkSymbolicCases([testCase]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch)
    expect(failure.actual).toEqual([
      { ...testCase, expected: ["index:0", "changed"], actual: "[ 'changed', 'index:2' ]" },
    ]);
});

it.each([false, true])("matches concrete cursor pin %s", (first) =>
  checkDifferentialCases([
    {
      name: `early return regexp cursor/${first}`,
      body: `const first = ${first}; const pattern = /a/g; if (first) { pattern.test('aba'); return 'changed'; } const result = pattern.exec('aba'); return 'index:' + result.index;`,
    },
  ]),
);
