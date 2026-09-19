import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
import { propertyDefinitionMethods } from "./helpers/property-definition-methods.js";

interface FieldPlacement {
  name: string;
  isInherited: boolean;
  isEnumerable: boolean;
}

interface FieldLayoutCase extends DifferentialCase {
  expected: string | number;
  actual?: string;
  isPrecisionGap?: boolean;
}

const placements: FieldPlacement[] = [
  { name: "own", isInherited: false, isEnumerable: true },
  { name: "hidden", isInherited: false, isEnumerable: false },
  { name: "inherited", isInherited: true, isEnumerable: true },
  { name: "inherited-hidden", isInherited: true, isEnumerable: false },
];
const getIsVisible = (placement: FieldPlacement): boolean =>
  !placement.isInherited && placement.isEnumerable;
const prelude = `const prototype = {}; const descriptor = Object.create(prototype); descriptor.enumerable = true; descriptor.configurable = true; let target = {};`;
const getFieldDefinition = (name: string, value: string, placement: FieldPlacement): string =>
  `Object.defineProperty(${placement.isInherited ? "prototype" : "descriptor"}, ${JSON.stringify(name)}, { value: ${value}, enumerable: ${placement.isEnumerable}, configurable: true, writable: true });`;
const accessorPrelude = `const trace = []; let stored = 7; const getter = () => { trace.push('get'); return stored; }; const setter = (value) => { trace.push('set:' + value); stored = value; };`;
const accessorObservation = `try { target.entry; trace.push('before'); target.entry = 9; target.entry; trace.push('after'); } catch (error) { trace.push('caught:' + error.name); } return trace.join('|') + '#' + stored;`;

const accessorCases = propertyDefinitionMethods.flatMap((method) =>
  placements.flatMap((getterPlacement) =>
    placements.map((setterPlacement) => ({
      name: `${method.name}/get=${getterPlacement.name}/set=${setterPlacement.name}`,
      expected: "get|before|set:9|get|after#9",
      actual: getIsVisible(getterPlacement)
        ? getIsVisible(setterPlacement)
          ? undefined
          : '"get|before|caught:TypeError#7"'
        : getIsVisible(setterPlacement)
          ? '"before|set:9|after#9"'
          : '"before|after#7"',
      body: `${prelude} ${accessorPrelude} ${getFieldDefinition("get", "getter", getterPlacement)} ${getFieldDefinition("set", "setter", setterPlacement)} ${method.statement} ${accessorObservation}`,
    })),
  ),
);

const dataCases = propertyDefinitionMethods.flatMap((method) =>
  placements.map((placement) => ({
    name: `${method.name}/value=${placement.name}`,
    expected: 7,
    actual: getIsVisible(placement)
      ? undefined
      : 'unknown(property "entry" defined with a dynamic descriptor)',
    isPrecisionGap: true,
    body: `${prelude} ${getFieldDefinition("value", "7", placement)} descriptor.writable = true; ${method.statement} return target.entry;`,
  })),
);

const writableCases = propertyDefinitionMethods.flatMap((method) =>
  placements.flatMap((placement) =>
    [false, true].map((isWritable) => ({
      name: `${method.name}/writable=${isWritable}/${placement.name}`,
      expected: isWritable ? "after:9" : "TypeError:7",
      actual: isWritable ? undefined : '"after:9"',
      body: `${prelude} descriptor.value = 7; ${getFieldDefinition("writable", String(isWritable), placement)} ${method.statement} try { target.entry = 9; return 'after:' + target.entry; } catch (error) { return error.name + ':' + target.entry; }`,
    })),
  ),
);

const invalidForms = [
  { name: "noncallable-get", field: "get", value: "7", setup: "" },
  { name: "get-value-conflict", field: "get", value: "undefined", setup: "descriptor.value = 7;" },
  {
    name: "writable-get-conflict",
    field: "writable",
    value: "false",
    setup: "descriptor.get = () => 7;",
  },
];
const invalidCases = propertyDefinitionMethods.flatMap((method) =>
  placements.flatMap((placement) =>
    invalidForms.map((form) => ({
      name: `${method.name}/${placement.name}/${form.name}`,
      expected: "TypeError:false",
      actual: '"after:true"',
      body: `${prelude} ${form.setup} ${getFieldDefinition(form.field, form.value, placement)} let outcome = 'after'; try { ${method.statement} } catch (error) { outcome = error.name; } return outcome + ':' + Object.hasOwn(target, 'entry');`,
    })),
  ),
);

const cases: FieldLayoutCase[] = [
  ...accessorCases,
  ...dataCases,
  ...writableCases,
  ...invalidCases,
];
it.each(
  cases.map((testCase) => ({
    label: `${testCase.actual === undefined ? "" : testCase.isPrecisionGap ? "known precision gap: " : "known divergence: "}${testCase.name}`,
    testCase,
  })),
)("$label", async ({ testCase: { name, body, expected, actual } }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (actual === undefined) await checkDifferentialCases([{ name, body }]);
  else await checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
});

it.each(
  placements.flatMap((getterPlacement) =>
    placements.map((setterPlacement) => ({
      name: `get=${getterPlacement.name}/set=${setterPlacement.name}`,
      body: `${prelude} ${accessorPrelude} ${getFieldDefinition("get", "getter", getterPlacement)} ${getFieldDefinition("set", "setter", setterPlacement)} Object.defineProperty(target, 'entry', { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true }); ${accessorObservation}`,
    })),
  ),
)("preserves explicitly retrieved accessor fields $name", (testCase) =>
  checkDifferentialCases([testCase]),
);

it.each(placements)("preserves explicitly retrieved data field $name", (placement) =>
  checkDifferentialCases([
    {
      name: placement.name,
      body: `${prelude} ${getFieldDefinition("value", "7", placement)} Object.defineProperty(target, 'entry', { value: descriptor.value, writable: true, enumerable: true, configurable: true }); return target.entry;`,
    },
  ]),
);

const getterFieldCases = placements.flatMap((placement) =>
  [false, true].map((isStaged) => ({
    name: `${placement.name}/staged=${isStaged}`,
    label: `${isStaged ? "" : "known divergence: "}${placement.name}/staged=${isStaged}`,
    isStaged,
    body: `const trace = []; const prototype = {}; const descriptor = Object.create(prototype); ${["writable", "value", "configurable", "enumerable"].map((field) => `Object.defineProperty(${placement.isInherited ? "prototype" : "descriptor"}, '${field}', { get() { trace.push('${field}:' + (this === descriptor)); return ${field === "value" ? "7" : "true"}; }, enumerable: ${placement.isEnumerable}, configurable: true });`).join(" ")} ${isStaged ? 'const enumerable = descriptor.enumerable; const configurable = descriptor.configurable; const value = descriptor.value; const writable = descriptor.writable; Object.defineProperty({}, "entry", { enumerable, configurable, value, writable });' : 'Object.defineProperty({}, "entry", descriptor);'} return trace.join('|');`,
  })),
);

it.each(getterFieldCases)("$label", async ({ name, body, isStaged }) => {
  const expected = "enumerable:true|configurable:true|value:true|writable:true";
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (isStaged) await checkDifferentialCases([{ name, body }]);
  else await checkKnownDifferentialWitnesses([{ name, body, expected, actual: '""' }]);
});
