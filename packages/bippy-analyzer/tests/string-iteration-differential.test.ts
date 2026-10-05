import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface StringIteration {
  name: string;
  source: string;
}
const iterations: StringIteration[] = [
  { name: "spread", source: "const items = [...value];" },
  { name: "Array.from", source: "const items = Array.from(value);" },
  {
    name: "for-of",
    source: "const items = []; for (const character of value) items.push(character);",
  },
  {
    name: "for-of-break",
    source:
      "const items = []; for (const character of value) { items.push(character); if (character === 'A') break; }",
  },
  {
    name: "for-of-continue",
    source:
      "const items = []; for (const character of value) { if (character === 'A') continue; items.push(character); }",
  },
  {
    name: "for-of-return",
    source:
      "const items = (() => { const collected = []; for (const character of value) { collected.push(character); if (character === 'A') return collected; } return collected; })();",
  },
  {
    name: "destructuring",
    source:
      "const [head, ...tail] = value; const items = head === undefined ? [] : [head, ...tail];",
  },
  { name: "Set", source: "const items = [...new Set(value)];" },
  {
    name: "delegation",
    source:
      "const iterator = ({ *items() { yield* value; } }).items(); const items = [...iterator];",
  },
];
const strings = ["", "abc", "AA😀A", "😀💡", "e\u0301", "\ud800", "\udc00", "a\u0000b"];
const cases: DifferentialCase[] = iterations.flatMap((iteration) =>
  [
    ...strings.map((value, index) => ({
      name: `${iteration.name}/string=${index}`,
      body: `const value = ${JSON.stringify(value)};`,
    })),
    {
      name: `${iteration.name}/guarded-strings`,
      body: `const value = (first ? '😀A' : 'B') + (second ? '💡' : '');`,
    },
  ].map((testCase) => ({
    ...testCase,
    body: `${testCase.body} ${iteration.source} const result = items.map((character) => character.codePointAt(0)).join(','); return typeof result + ':' + result;`,
  })),
);

it.each(cases)("matches native string iteration and replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches every concrete string-iteration input for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
