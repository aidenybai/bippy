import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkExpectedDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "Object.defineProperty creates an ordinary data property",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7 }); return target.value;`,
  },
  {
    name: "delete removes a configurable property without reading its getter",
    body: `const trace = []; const target = { get value() { trace.push('get'); throw 'get'; } }; const result = delete target.value; return result + ':' + Object.hasOwn(target, 'value') + ':' + trace.join('|');`,
  },
  {
    name: "Object.isFrozen recognizes an explicitly frozen object",
    body: `return Object.isFrozen(Object.freeze({}));`,
  },
  {
    name: "Object.getOwnPropertyDescriptor snapshots a data value",
    body: `const target = { value: 7 }; const descriptor = Object.getOwnPropertyDescriptor(target, 'value'); target.value = 9; return descriptor.value;`,
  },
])("preserves adjacent control: $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "Object.freeze prevents new strict-mode property writes",
    expected: "TypeError",
    body: `const target = Object.freeze({}); try { target.value = 7; return 'accepted:' + String(target.value); } catch (error) { return error.name; }`,
  },
])("preserves $name", (testCase) => checkExpectedDifferentialCases([testCase]));

it.each([
  {
    name: "Reflect.defineProperty returns true and defines a data property",
    expected: "true:7",
    actual: "<string: + on dynamic values>",
    body: `const target = {}; const result = Reflect.defineProperty(target, 'value', { value: 7, configurable: true }); return result + ':' + target.value;`,
  },
  {
    name: "Reflect.defineProperty returns false for a forbidden redefinition",
    expected: false,
    actual: "unknown(Reflect.defineProperty())",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 1 }); return Reflect.defineProperty(target, 'value', { value: 7 });`,
  },
  {
    name: "Reflect.defineProperty throws for an invalid descriptor",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { Reflect.defineProperty({}, 'value', { get: () => 1, value: 7 }); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "Reflect.defineProperty converts descriptor fields before defining",
    expected: "enumerable|configurable|value|writable:7",
    actual: '":undefined"',
    body: `const trace = []; const target = {}; const descriptor = { get enumerable() { trace.push('enumerable'); return true; }, get configurable() { trace.push('configurable'); return true; }, get value() { trace.push('value'); return 7; }, get writable() { trace.push('writable'); return true; } }; Reflect.defineProperty(target, 'value', descriptor); return trace.join('|') + ':' + target.value;`,
  },
  {
    name: "Reflect.deleteProperty removes a configurable property",
    expected: "true:false",
    actual: "<string: + on dynamic values>",
    body: `const target = { value: 7 }; const result = Reflect.deleteProperty(target, 'value'); return result + ':' + Object.hasOwn(target, 'value');`,
  },
  {
    name: "Reflect.deleteProperty returns false for a nonconfigurable property",
    expected: false,
    actual: "unknown(Reflect.deleteProperty())",
    body: `const target = {}; Object.defineProperty(target, 'value', { value: 7 }); return Reflect.deleteProperty(target, 'value');`,
  },
  {
    name: "Reflect.deleteProperty does not invoke the deleted getter",
    expected: ":false",
    actual: '":true"',
    body: `const trace = []; const target = { get value() { trace.push('get'); throw 'get'; } }; Reflect.deleteProperty(target, 'value'); return trace.join('|') + ':' + Object.hasOwn(target, 'value');`,
  },
  {
    name: "Reflect.preventExtensions blocks subsequent property creation",
    expected: "TypeError",
    actual: '"accepted"',
    body: `const target = {}; Reflect.preventExtensions(target); try { target.value = 7; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "Reflect.isExtensible observes nonextensible objects",
    expected: false,
    actual: "unknown(Reflect.isExtensible())",
    body: `const target = Object.freeze({}); return Reflect.isExtensible(target);`,
  },
  {
    name: "Reflect.setPrototypeOf changes inherited lookup and returns true",
    expected: "true:7",
    actual: "<string: + on dynamic values>",
    body: `const target = {}; const result = Reflect.setPrototypeOf(target, { value: 7 }); return result + ':' + target.value;`,
  },
  {
    name: "Reflect.setPrototypeOf returns false for nonextensible targets",
    expected: false,
    actual: "unknown(Reflect.setPrototypeOf())",
    body: `const target = Object.freeze({}); return Reflect.setPrototypeOf(target, null);`,
  },
  {
    name: "Reflect.setPrototypeOf throws for invalid prototype values",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { Reflect.setPrototypeOf({}, 7); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "Reflect.getOwnPropertyDescriptor returns a descriptor snapshot",
    expected: 7,
    actual: "unknown(Reflect.getOwnPropertyDescriptor())",
    body: `const target = { value: 7 }; const descriptor = Reflect.getOwnPropertyDescriptor(target, 'value'); target.value = 9; return descriptor.value;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  { name: "defineProperty", call: "Reflect.defineProperty(7, 'value', { value: 1 })" },
  { name: "deleteProperty", call: "Reflect.deleteProperty(7, 'value')" },
  { name: "preventExtensions", call: "Reflect.preventExtensions(7)" },
  { name: "isExtensible", call: "Reflect.isExtensible(7)" },
  { name: "setPrototypeOf", call: "Reflect.setPrototypeOf(7, null)" },
  { name: "getOwnPropertyDescriptor", call: "Reflect.getOwnPropertyDescriptor(7, 'value')" },
])("known divergence: Reflect.$name primitive-target rejection", ({ name, call }) =>
  checkKnownDifferentialWitnesses([
    {
      name: `${name}/primitive-target`,
      expected: "TypeError",
      actual: '"accepted"',
      body: `try { ${call}; return 'accepted'; } catch (error) { return error.name; }`,
    },
  ]),
);
