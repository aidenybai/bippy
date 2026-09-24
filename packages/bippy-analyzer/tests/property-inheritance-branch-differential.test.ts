import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const cases: DifferentialCase[] = [
  ...["constructor", "__proto__", "toString", "hasOwnProperty"].map((key) => ({
    name: `an own undefined ${key} shadows its inherited value`,
    body: `const value = {}; if (first) Object.defineProperty(value, ${JSON.stringify(key)}, { value: undefined, enumerable: true, configurable: true }); return String(value[${JSON.stringify(key)}] === undefined);`,
  })),
  {
    name: "inherited undefined constructor is not replaced by Object",
    body: `const prototype = { constructor: undefined }; const value = Object.create(prototype); return String(value.constructor);`,
  },
  {
    name: "a null prototype has no legacy prototype getter",
    body: `const value = Object.create(null); return String(value.__proto__) + ':' + String(value.constructor);`,
  },
  {
    name: "a chain ending at null does not invent a legacy getter",
    body: `const prototype = Object.create(null); const value = Object.create(prototype); return String(value.__proto__) + ':' + String(value.constructor);`,
  },
  {
    name: "the inherited legacy getter returns its receiver's prototype",
    body: `const prototype = { marker: 1 }; const value = Object.create(prototype); return String(value.__proto__ === prototype);`,
  },
  {
    name: "a prototype's own undefined legacy key shadows the getter",
    body: `const prototype = Object.fromEntries([['__proto__', undefined]]); const value = Object.create(prototype); return String(value.__proto__);`,
  },
  {
    name: "an inherited legacy-key accessor retains its receiver",
    body: `const prototype = { get __proto__() { return this.marker; } }; const value = Object.create(prototype); value.marker = first ? 7 : 9; return String(value.__proto__);`,
  },
  {
    name: "conditionally shadowed getters execute only on absent paths",
    body: `let count = 0; const prototype = { get value() { count++; return this.marker; } }; const value = Object.create(prototype); value.marker = 7; if (first) Object.defineProperty(value, 'value', { value: undefined, enumerable: true }); const before = value.value; if (second) value.value; return String(before) + ':' + count;`,
  },
  {
    name: "conditionally shadowed getters preserve effects before exceptions",
    body: `const inputSecond = second; let count = 0; const prototype = { get value() { count++; if (inputSecond) throw new Error('stop'); return 7; } }; const value = Object.create(prototype); if (first) Object.defineProperty(value, 'value', { value: undefined, enumerable: true }); try { return String(value.value) + ':' + count; } catch (error) { return error.message + ':' + count; }`,
  },
  {
    name: "Map's legacy getter uses its native prototype witness",
    body: `return String(new Map().__proto__ === Map.prototype);`,
  },
  {
    name: "Set's legacy getter uses its native prototype witness",
    body: `return String(new Set().__proto__ === Set.prototype);`,
  },
];

it.each(cases)("matches native inherited-property states and replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches every concrete inherited-property input for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
