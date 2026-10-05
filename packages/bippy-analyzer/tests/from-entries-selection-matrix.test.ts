import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface EntryKeyCase {
  name: string;
  left: string;
  right: string;
}

interface EntryConstruction {
  name: string;
  source: string;
}

const keys: EntryKeyCase[] = [
  { name: "strings", left: "'left'", right: "'right'" },
  { name: "indices", left: "1", right: "2" },
  { name: "bigints", left: "1n", right: "2n" },
  { name: "symbols", left: "Symbol('left')", right: "Symbol('right')" },
  { name: "registered-symbols", left: "Symbol.for('left')", right: "Symbol.for('right')" },
  { name: "prototype-names", left: "'__proto__'", right: "'constructor'" },
];
const constructions: EntryConstruction[] = [
  { name: "key", source: "const result = Object.fromEntries([[key, payload]]);" },
  {
    name: "pair",
    source:
      "const result = Object.fromEntries([inputFirst ? [leftKey, payload] : [rightKey, payload]]);",
  },
  {
    name: "container",
    source:
      "const result = Object.fromEntries(inputFirst ? [[leftKey, payload]] : [[rightKey, payload]]);",
  },
  {
    name: "optional-pairs",
    source:
      "const entries = []; if (inputFirst) entries.push([leftKey, payload]); else entries.push([rightKey, payload]); const result = Object.fromEntries(entries);",
  },
  {
    name: "spread-container",
    source:
      "const result = Object.fromEntries([...(inputFirst ? [[leftKey, payload]] : [[rightKey, payload]])]);",
  },
];
const cases: DifferentialCase[] = keys.flatMap((keyCase) =>
  constructions.map((construction) => ({
    name: `${keyCase.name}/${construction.name}`,
    body: `const inputFirst = first; const inputSecond = second; const leftKey = ${keyCase.left}; const rightKey = ${keyCase.right}; const key = inputFirst ? leftKey : rightKey; const payload = { value: 0 }; ${construction.source} payload.value = inputSecond ? 7 : 9; const selected = inputFirst ? result[leftKey] : result[rightKey]; const absent = inputFirst ? result[rightKey] : result[leftKey]; selected.value++; return String(selected === payload) + ':' + String(absent === undefined) + ':' + payload.value;`,
  })),
);
cases.push(
  {
    name: "independent optional entries retain their presence and order",
    body: `const entries = []; if (first) entries.push(['left', 1]); if (second) entries.push(['right', 2]); const result = Object.fromEntries(entries); return Object.keys(result).join('/') + ':' + String(result.left) + ':' + String(result.right);`,
  },
  {
    name: "later optional entries overwrite earlier values without extra states",
    body: `const entries = [['item', 0]]; if (first) entries.push(['item', 1]); if (second) entries.push(['item', 2]); return String(Object.fromEntries(entries).item);`,
  },
  {
    name: "empty and short pairs supply undefined fields",
    body: `const result = Object.fromEntries(first ? [[]] : [['item']]); return Object.keys(result).join('/') + ':' + String(result.undefined) + ':' + String(result.item);`,
  },
  {
    name: "selecting an iterator does not consume its sibling",
    body: `const left = new Map([['left', 1]]).entries(); const right = new Map([['right', 2]]).entries(); const result = Object.fromEntries(first ? left : right); return Object.keys(result).join('/') + ':' + left.next().done + ':' + right.next().done;`,
  },
  {
    name: "a partially consumed guarded cursor supplies its remaining entries",
    body: `const iterator = ({ *entries() { yield ['left', 1]; yield ['right', 2]; } }).entries(); if (first) iterator.next(); const result = Object.fromEntries(iterator); return Object.keys(result).join('/') + ':' + iterator.next().done;`,
  },
);

it.each(cases)("preserves native entry selection and replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches every concrete entry-selection input for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
