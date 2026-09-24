import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface DescriptorKeys {
  name: string;
  left: string;
  right: string;
}

interface DescriptorPayload {
  name: string;
  create: string;
  mutate: string;
  observe: string;
}

interface DescriptorConstruction {
  name: string;
  source: string;
}

const keys: DescriptorKeys[] = [
  { name: "strings", left: "'left'", right: "'right'" },
  { name: "indices", left: "1", right: "2" },
  { name: "symbols", left: "Symbol('left')", right: "Symbol('right')" },
  { name: "registered-symbols", left: "Symbol.for('left')", right: "Symbol.for('right')" },
];
const payloads: DescriptorPayload[] = [
  {
    name: "object",
    create: "({ count: 0 })",
    mutate: "selected.count = inputSecond ? 7 : 9;",
    observe: "payload.count",
  },
  {
    name: "array",
    create: "[0]",
    mutate: "selected.push(inputSecond ? 7 : 9);",
    observe: "payload.join(',')",
  },
  {
    name: "date",
    create: "new Date(0)",
    mutate: "selected.setTime(inputSecond ? 7 : 9);",
    observe: "payload.getTime()",
  },
  {
    name: "iterator",
    create: "({ *values() { yield 1; yield 2; } }).values()",
    mutate: "selected.next(); if (inputSecond) selected.next();",
    observe: "payload.next().value",
  },
];
const constructions: DescriptorConstruction[] = [
  {
    name: "computed-literal-map",
    source: "Object.defineProperties(result, { [key]: descriptor });",
  },
  {
    name: "selected-map",
    source:
      "Object.defineProperties(result, inputFirst ? { [leftKey]: descriptor } : { [rightKey]: descriptor });",
  },
  { name: "selected-key", source: "Object.defineProperty(result, key, descriptor);" },
  {
    name: "selected-descriptor",
    source:
      "Object.defineProperty(result, key, inputSecond ? descriptor : { value: payload, enumerable: true });",
  },
  {
    name: "selected-descriptor-field",
    source:
      "Object.defineProperties(result, { [key]: inputSecond ? descriptor : { value: payload, enumerable: true } });",
  },
  {
    name: "created-map",
    source:
      "result = Object.create(null, inputFirst ? { [leftKey]: descriptor } : { [rightKey]: descriptor });",
  },
  {
    name: "staged-map",
    source:
      "const descriptors = {}; descriptors[key] = descriptor; Object.defineProperties(result, descriptors);",
  },
  {
    name: "created-descriptor-field",
    source:
      "result = Object.create(null, { [key]: inputSecond ? descriptor : { value: payload, enumerable: true } });",
  },
  {
    name: "selected-target",
    source:
      "result = inputFirst ? { origin: 'left' } : { origin: 'right' }; Object.defineProperty(result, key, descriptor);",
  },
];
const cases: DifferentialCase[] = keys.flatMap((keyCase) =>
  payloads.flatMap((payload) =>
    constructions.map((construction) => ({
      name: `${keyCase.name}/${payload.name}/${construction.name}`,
      body: `const inputFirst = first; const inputSecond = second; const leftKey = ${keyCase.left}; const rightKey = ${keyCase.right}; const key = inputFirst ? leftKey : rightKey; const payload = ${payload.create}; const descriptor = { value: payload, enumerable: true, configurable: true, writable: true }; let result = {}; ${construction.source} const selected = inputFirst ? result[leftKey] : result[rightKey]; const absent = inputFirst ? result[rightKey] : result[leftKey]; ${payload.mutate} return (selected === payload ? 'same' : 'different') + ':' + (absent === undefined ? 'absent' : 'extra') + ':' + String(${payload.observe});`,
    })),
  ),
);
cases.push(
  {
    name: "computed keys do not reevaluate prefixes or suffixes",
    body: `const key = first ? 'left' : 'right'; let count = 0; const value = { prefix: ++count, [(count++, key)]: ++count, suffix: ++count }; return [count, value.prefix, value[key], value.suffix].join(':');`,
  },
  {
    name: "two independent keys preserve property order and overwrites",
    body: `const left = first ? 'left' : 'right'; const right = second ? 'left' : 'right'; let count = 0; const value = { [left]: ++count, [right]: ++count, suffix: ++count }; return Object.keys(value).join(',') + ':' + String(value.left) + ':' + String(value.right) + ':' + count;`,
  },
  {
    name: "computed setter alternatives do not mutate a shared accessor prefix",
    body: `const key = first ? 'item' : 'other'; const value = { get item() { return 10; }, set [key](next) {} }; const descriptor = Object.getOwnPropertyDescriptor(value, 'item'); return (descriptor.get ? 'get' : '-') + ':' + (descriptor.set ? 'set' : '-') + ':' + value.item;`,
  },
  {
    name: "computed method names match their selected keys",
    body: `const key = first ? 'left' : 'right'; const value = { [key]() { return 1; } }; return value[key].name;`,
  },
  {
    name: "descriptor calls return their original target",
    body: `const target = {}; const key = first ? 'left' : 'right'; const descriptor = second ? { value: 7 } : { value: 9 }; const defined = Object.defineProperty(target, key, descriptor); const definedMany = Object.defineProperties(target, {}); return String(defined === target && definedMany === target);`,
  },
);

it.each(cases)("preserves native descriptor state and replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches every concrete descriptor-matrix assignment for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
