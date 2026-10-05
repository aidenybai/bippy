import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { checkDifferentialCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

import { propertyDefinitionMethods } from "./helpers/property-definition-methods.js";

interface AccessorObservation {
  name: string;
  source: string;
  getExpected: (isFirst: boolean, isSecond: boolean) => string;
}

const observations: AccessorObservation[] = [
  {
    name: "getter",
    source: "return String(target.entry);",
    getExpected: (isFirst, isSecond) => String((isFirst ? 1 : 10) + (isSecond ? 7 : 9)),
  },
  {
    name: "setter",
    source: "target.entry = inputFirst ? 7 : 9; return String(target.stored);",
    getExpected: (isFirst, isSecond) => String((isFirst ? 7 : 9) * (isSecond ? 2 : 3)),
  },
  {
    name: "getter-identity",
    source: "return String(Object.getOwnPropertyDescriptor(target, 'entry').get === getter);",
    getExpected: () => "true",
  },
  {
    name: "setter-identity",
    source: "return String(Object.getOwnPropertyDescriptor(target, 'entry').set === setter);",
    getExpected: () => "true",
  },
  {
    name: "borrowed-getter",
    source:
      "const foreign = { stored: inputSecond ? 3 : 5 }; return String(Object.getOwnPropertyDescriptor(target, 'entry').get.call(foreign));",
    getExpected: (isFirst, isSecond) => String((isFirst ? 1 : 10) + (isSecond ? 3 : 5)),
  },
  {
    name: "borrowed-setter",
    source:
      "const foreign = { stored: 0 }; Object.getOwnPropertyDescriptor(target, 'entry').set.call(foreign, inputFirst ? 3 : 5); return String(foreign.stored);",
    getExpected: (isFirst, isSecond) => String((isFirst ? 3 : 5) * (isSecond ? 2 : 3)),
  },
  {
    name: "borrowed-isolation",
    source:
      "target.stored = 100; const foreign = { stored: 0 }; Object.getOwnPropertyDescriptor(target, 'entry').set.call(foreign, inputFirst ? 3 : 5); return String(target.stored);",
    getExpected: () => "100",
  },
];
const cases = propertyDefinitionMethods.flatMap((method) =>
  observations.map((observation) => ({
    name: `${method.name}/${observation.name}`,
    getExpected: observation.getExpected,
    body: `const inputFirst = first; const inputSecond = second; const operations = { firstGet() { return this.stored + 1; }, secondGet() { return this.stored + 10; }, firstSet(value) { this.stored = value * 2; }, secondSet(value) { this.stored = value * 3; } }; const getter = inputFirst ? operations.firstGet : operations.secondGet; const setter = inputSecond ? operations.firstSet : operations.secondSet; const descriptor = { get: getter, set: setter, enumerable: true, configurable: true }; let target = {}; ${method.statement} target.stored = inputSecond ? 7 : 9; ${observation.source}`,
  })),
);

it.each(cases)(
  "preserves symbolic accessor callbacks $name",
  async ({ name, body, getExpected }) => {
    for (let index = 0; index < 4; index++) {
      expect(
        runInNewContext(
          `"use strict"; (() => { ${body} })()`,
          { first: !!(index & 2), second: !!(index & 1) },
          { timeout: 1000 },
        ),
      ).toBe(getExpected(!!(index & 2), !!(index & 1)));
    }
    await checkSymbolicCases([{ name, body }]);
  },
);

it.each(cases)("matches every concrete accessor-callback pin $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
