import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  DifferentialMismatch,
} from "./helpers/differential-evaluator.js";

import { propertyShapeObservations } from "./helpers/property-shape-observations.js";

interface DescriptorEncoding {
  name: string;
  source: string;
}

const encodings: DescriptorEncoding[] = [
  {
    name: "bulk-key-branch",
    source:
      "const result = {}; Object.defineProperties(result, { [inputFirst ? 'left' : 'right']: descriptor });",
  },
  {
    name: "bulk-container-branch",
    source:
      "const result = {}; Object.defineProperties(result, inputFirst ? { left: descriptor } : { right: descriptor });",
  },
  {
    name: "single-key-branch",
    source:
      "const result = {}; Object.defineProperty(result, inputFirst ? 'left' : 'right', descriptor);",
  },
  {
    name: "single-descriptor-branch",
    source:
      "const result = {}; if (inputFirst) Object.defineProperty(result, 'left', chosenDescriptor); else Object.defineProperty(result, 'right', chosenDescriptor);",
  },
  {
    name: "bulk-descriptor-branch",
    source:
      "const result = {}; if (inputFirst) Object.defineProperties(result, { left: chosenDescriptor }); else Object.defineProperties(result, { right: chosenDescriptor });",
  },
  {
    name: "create-container-branch",
    source:
      "const result = Object.create(null, inputFirst ? { left: descriptor } : { right: descriptor });",
  },
  {
    name: "bulk-call-branch",
    source:
      "const result = inputFirst ? Object.defineProperties({}, { left: descriptor }) : Object.defineProperties({}, { right: descriptor });",
  },
  {
    name: "single-call-branch",
    source:
      "const result = {}; if (inputFirst) Object.defineProperty(result, 'left', descriptor); else Object.defineProperty(result, 'right', descriptor);",
  },
  {
    name: "create-call-branch",
    source:
      "const result = inputFirst ? Object.create(null, { left: descriptor }) : Object.create(null, { right: descriptor });",
  },
  {
    name: "assignment-control",
    source: "const result = {}; result[inputFirst ? 'left' : 'right'] = value;",
  },
  {
    name: "staged-map",
    source:
      "const descriptors = {}; descriptors[inputFirst ? 'left' : 'right'] = descriptor; const result = {}; Object.defineProperties(result, descriptors);",
  },
];
const knownEncodings = new Set([
  "bulk-key-branch",
  "bulk-container-branch",
  "single-key-branch",
  "single-descriptor-branch",
  "bulk-descriptor-branch",
  "create-container-branch",
  "staged-map",
]);
const cases = encodings.flatMap((encoding) =>
  propertyShapeObservations.map((observation) => ({
    name: `${encoding.name}/${observation.name}`,
    label: `${knownEncodings.has(encoding.name) && observation.name !== "absence" ? "known divergence: " : ""}${encoding.name}/${observation.name}`,
    isKnown: knownEncodings.has(encoding.name) && observation.name !== "absence",
    body: `const inputFirst = first; const inputSecond = second; const value = inputSecond ? 7 : 9; const descriptor = { value, enumerable: true, configurable: true, writable: true }; const chosenDescriptor = inputSecond ? { value: 7, enumerable: true, configurable: true, writable: true } : { value: 9, enumerable: true, configurable: true, writable: true }; ${encoding.source} ${observation.source}`,
  })),
);

it.each(cases)("$label", async ({ name, body, isKnown }) => {
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
  const witness = { name, body, expected: ["match"], actual: "[ 'missing' ]" };
  const failure: unknown = await checkSymbolicCases([witness]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(DifferentialMismatch);
  if (failure instanceof DifferentialMismatch) expect(failure.actual).toEqual([witness]);
});

it.each(cases)("matches every concrete descriptor-selection pin $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
