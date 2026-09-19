import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

import { propertyShapeObservations } from "./helpers/property-shape-observations.js";

interface EntryEncoding {
  name: string;
  source: string;
}

const encodings: EntryEncoding[] = [
  {
    name: "key-branch",
    source: "const result = Object.fromEntries([[inputFirst ? 'left' : 'right', value]]);",
  },
  {
    name: "pair-branch",
    source: "const result = Object.fromEntries([inputFirst ? ['left', value] : ['right', value]]);",
  },
  {
    name: "container-branch",
    source:
      "const result = Object.fromEntries(inputFirst ? [['left', value]] : [['right', value]]);",
  },
  {
    name: "result-branch",
    source:
      "const result = inputFirst ? Object.fromEntries([['left', value]]) : Object.fromEntries([['right', value]]);",
  },
  {
    name: "mutating-list",
    source:
      "const entries = []; if (inputFirst) entries.push(['left', value]); else entries.push(['right', value]); const result = Object.fromEntries(entries);",
  },
  {
    name: "spread-container",
    source:
      "const result = Object.fromEntries([...(inputFirst ? [['left', value]] : [['right', value]])]);",
  },
  {
    name: "object-key-branch",
    source: "const result = { [inputFirst ? 'left' : 'right']: value };",
  },
  {
    name: "object-key-assignment",
    source: "const result = {}; result[inputFirst ? 'left' : 'right'] = value;",
  },
  {
    name: "pair-assignment",
    source:
      "const pair = inputFirst ? ['left', value] : ['right', value]; const result = {}; result[pair[0]] = pair[1];",
  },
  {
    name: "object-result-branch",
    source: "const result = inputFirst ? { left: value } : { right: value };",
  },
];
const knownEncodings = new Set([
  "key-branch",
  "pair-branch",
  "container-branch",
  "mutating-list",
  "spread-container",
  "object-key-branch",
]);
const cases = encodings.flatMap((encoding) =>
  propertyShapeObservations.map((observation) => ({
    name: `${encoding.name}/${observation.name}`,
    label: `${knownEncodings.has(encoding.name) ? "known precision gap: " : ""}${encoding.name}/${observation.name}`,
    isKnown: knownEncodings.has(encoding.name),
    actual: observation.name === "absence" ? "[ 'extra', 'match' ]" : "[ 'match', 'missing' ]",
    body: `const inputFirst = first; const value = second ? 7 : 9; ${encoding.source} ${observation.source}`,
  })),
);

it.each(cases)("$label", async ({ name, body, isKnown, actual }) => {
  for (let index = 0; index < 4; index++) {
    expect(
      runInNewContext(
        `"use strict"; (() => { ${body} })()`,
        { first: !!(index & 2), second: !!(index & 1) },
        { timeout: 1000 },
      ),
    ).toBe("match");
  }
  if (!isKnown) return checkSymbolicCases([{ name, body }]);
  const witness = { name, body, expected: ["match"], actual };
  const failure: unknown = await checkSymbolicCases([witness]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([witness]);
});

it.each(cases)("matches every concrete entry-shape pin $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
