import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches positional arguments of named-capture replacements, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const fragments = ["a", "b", "😀", " "];
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const text = Array.from(
        { length: getRandom(10) },
        () => fragments[getRandom(fragments.length)],
      ).join("");
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      const text = ${JSON.stringify(text)};
      const result = text.replace(/(?<first>a)(?<second>b)?/g, (matched, first, second, offset, input, groups) => {
        trace.push(matched + ':' + first + ':' + second + ':' + offset + ':' + (input === text));
        return '[' + offset + ']';
      });
      return result + '#' + trace.join('|');
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "named group properties are accessible to the callback",
    body: `return 'ab'.replace(/(?<first>a)(?<second>b)/, (matched, first, second, offset, input, groups) => groups.second + groups.first);`,
  },
  {
    name: "named group object has a null prototype",
    body: `let result; 'a'.replace(/(?<letter>a)/, (matched, letter, offset, input, groups) => { result = Object.getPrototypeOf(groups) === null; return matched; }); return result;`,
  },
  {
    name: "mutating named groups does not alter positional capture arguments",
    body: `return 'a'.replace(/(?<letter>a)/, (matched, letter, offset, input, groups) => { groups.letter = 'z'; return letter + ':' + groups.letter; });`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "symbol replace receives the original replacement argument",
    expected: "abc:true",
    actual: "<string: replace()>",
    body: `const replacement = () => 'unused'; const pattern = { [Symbol.replace](input, received) { return input + ':' + (received === replacement); } }; return 'abc'.replace(pattern, replacement);`,
  },
  {
    name: "throwing symbol replace lookup stops the operation",
    expected: "lookup|caught:stop",
    actual: JSON.stringify("after"),
    body: `const trace = []; const pattern = { get [Symbol.replace]() { trace.push('lookup'); throw 'stop'; } }; try { 'abc'.replace(pattern, 'x'); trace.push('after'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "named group objects are distinct for each match",
    body: `let previous; const trace = []; 'aa'.replace(/(?<letter>a)/g, (matched, letter, offset, input, groups) => { trace.push(groups === previous); previous = groups; return matched; }); return trace.join(',');`,
  },
  {
    name: "exec exposes optional named groups as own properties",
    body: `const groups = /(?<first>a)(?<second>b)?/.exec('a').groups; return Object.hasOwn(groups, 'second') + ':' + String(groups.second);`,
  },
  {
    name: "exec named group keys retain declaration order",
    body: `return Object.keys(/(?<second>a)(?<first>b)/.exec('ab').groups).join(',');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "optional named groups are own properties with undefined values",
    body: `let result; 'a'.replace(/(?<first>a)(?<second>b)?/, (matched, first, second, offset, input, groups) => { result = Object.hasOwn(groups, 'second') + ':' + String(groups.second); return matched; }); return result;`,
  },
  {
    name: "named group keys retain declaration order",
    body: `return 'ab'.replace(/(?<second>a)(?<first>b)/, (matched, second, first, offset, input, groups) => Object.keys(groups).join(','));`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
