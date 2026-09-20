import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface AccessorFlags {
  configurable: boolean;
  enumerable: boolean;
}

const flags: AccessorFlags[] = Array.from({ length: 4 }, (_value, index) => ({
  configurable: (index & 1) !== 0,
  enumerable: (index & 2) !== 0,
}));

const cases = flags.flatMap((initial, initialIndex) =>
  flags.flatMap((replacement, replacementIndex) =>
    [false, true].flatMap((changesGetter) =>
      [false, true].map((changesSetter) => {
        const isAllowed =
          initial.configurable ||
          (!replacement.configurable &&
            initial.enumerable === replacement.enumerable &&
            !changesGetter &&
            !changesSetter);
        const name = `accessor flags ${initialIndex}/${replacementIndex}/getter=${changesGetter}/setter=${changesSetter}`;
        const result = `${changesGetter ? 2 : 1}:${changesSetter ? 7 : 3}:${replacement.enumerable ? "value" : ""}`;
        return {
          name,
          label: `${isAllowed ? "" : "known divergence: "}${name}`,
          isAllowed,
          body: `
      let stored = 0;
      const target = {};
      const originalGet = () => 1;
      const originalSet = (value) => { stored = value; };
      const replacementGet = ${changesGetter ? "() => 2" : "originalGet"};
      const replacementSet = ${changesSetter ? "(value) => { stored = value + 4; }" : "originalSet"};
      Object.defineProperty(target, 'value', { get: originalGet, set: originalSet, configurable: ${initial.configurable}, enumerable: ${initial.enumerable} });
      let outcome = 'accepted';
      try { Object.defineProperty(target, 'value', { get: replacementGet, set: replacementSet, configurable: ${replacement.configurable}, enumerable: ${replacement.enumerable} }); }
      catch (error) { outcome = error.name; }
      target.value = 3;
      return outcome + ':' + target.value + ':' + stored + ':' + Object.keys(target).join(',');
    `,
          expected: `TypeError:1:3:${initial.enumerable ? "value" : ""}`,
          actual: JSON.stringify(`accepted:${result}`),
        };
      }),
    ),
  ),
);

it.each(cases)("$label", ({ name, body, isAllowed, expected, actual }) =>
  isAllowed
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
);

it.each([
  {
    name: "omitted accessor fields retain the existing getter",
    expected: 7,
    actual: 'unknown(property "value" defined with a dynamic descriptor)',
    body: `const target = {}; Object.defineProperty(target, 'value', { get: () => 7, configurable: true }); Object.defineProperty(target, 'value', { enumerable: true }); return target.value;`,
  },
  {
    name: "accessor-to-data conversion gives omitted value undefined",
    expected: undefined,
    actual: 'unknown(property "value" defined with a dynamic descriptor)',
    body: `const target = {}; Object.defineProperty(target, 'value', { get: () => 7, configurable: true }); Object.defineProperty(target, 'value', { writable: true }); return target.value;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "clearing a getter makes subsequent reads undefined",
    body: `const target = {}; Object.defineProperty(target, 'value', { get: () => 7, configurable: true }); Object.defineProperty(target, 'value', { get: undefined }); return target.value;`,
  },
  {
    name: "clearing a setter makes strict assignments throw",
    body: `const target = {}; Object.defineProperty(target, 'value', { set(value) {}, configurable: true }); Object.defineProperty(target, 'value', { set: undefined }); try { target.value = 7; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "data-to-accessor conversion removes the old data value",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7, configurable: true }); Object.defineProperty(target, 'value', { get: () => 9 }); return target.value;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
