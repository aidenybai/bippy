import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "instance super follows changes to the home prototype parent",
    expected: "1:7:1",
    actual: '"1:1:1"',
    body: `class Base { read() { return 1; } } class Other { read() { return 7; } } class Child extends Base { read() { return super.read(); } } const instance = new Child(); const before = instance.read(); Object.setPrototypeOf(Child.prototype, Other.prototype); const changed = instance.read(); Object.setPrototypeOf(Child.prototype, Base.prototype); return before + ':' + changed + ':' + instance.read();`,
  },
  {
    name: "static super follows changes to the home constructor parent",
    expected: "1:7:1",
    actual: '"1:1:1"',
    body: `class Base { static read() { return 1; } } class Other { static read() { return 7; } } class Child extends Base { static read() { return super.read(); } } const before = Child.read(); Object.setPrototypeOf(Child, Other); const changed = Child.read(); Object.setPrototypeOf(Child, Base); return before + ':' + changed + ':' + Child.read();`,
  },
  {
    name: "object literal super reads from its home object prototype",
    expected: 8,
    actual: "<any: + on dynamic values>",
    body: `const base = { read() { return this.value; } }; const target = { __proto__: base, value: 7, read() { return super.read() + 1; } }; return target.read();`,
  },
  {
    name: "borrowed object literal methods retain their home object",
    expected: 8,
    actual: "<any: + on dynamic values>",
    body: `const base = { read() { return this.value; } }; const target = { __proto__: base, read() { return super.read() + 1; } }; return target.read.call({ value: 7 });`,
  },
  {
    name: "super calls observe deletion of a base prototype method",
    expected: "TypeError",
    actual: "1",
    body: `class Base { read() { return 1; } } class Child extends Base { read() { return super.read(); } } const instance = new Child(); delete Base.prototype.read; try { return instance.read(); } catch (error) { return error.name; }`,
  },
  {
    name: "ordinary local prototype changes affect inherited lookup",
    expected: "1:7:true",
    actual: '"1:1:true"',
    body: `const first = { value: 1 }; const second = { value: 7 }; const target = Object.create(first); const before = target.value; const result = Object.setPrototypeOf(target, second); return before + ':' + target.value + ':' + (result === target);`,
  },
  {
    name: "invalid prototype values throw before returning the target",
    expected: "TypeError",
    actual: '"accepted"',
    body: `try { Object.setPrototypeOf({}, 7); return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "nonextensible local objects reject a different prototype",
    expected: "TypeError",
    actual: '"accepted"',
    body: `const target = Object.preventExtensions({}); try { Object.setPrototypeOf(target, null); return 'accepted'; } catch (error) { return error.name; }`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it.each([
  {
    name: "super calls observe replacement of a base prototype method",
    body: `class Base { read() { return 1; } } class Child extends Base { read() { return super.read(); } } const instance = new Child(); const before = instance.read(); Base.prototype.read = () => 7; return before + ':' + instance.read();`,
  },
  {
    name: "nonextensible local objects permit an unchanged prototype",
    body: `const prototype = {}; const target = Object.preventExtensions(Object.create(prototype)); return Object.setPrototypeOf(target, prototype) === target;`,
  },
  {
    name: "setting a primitive target prototype returns that primitive",
    body: `return Object.setPrototypeOf(7, null);`,
  },
  {
    name: "an own property continues to mask prototype properties",
    body: `const target = { value: 1 }; Object.setPrototypeOf(target, { value: 7 }); return target.value;`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));
