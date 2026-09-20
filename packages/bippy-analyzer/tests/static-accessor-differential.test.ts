import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "unread static getters have no effects during class definition",
    expected: "defined",
    actual: '"get|defined"',
    body: `const trace = []; class Target { static get value() { trace.push('get'); return 7; } } trace.push('defined'); return trace.join('|');`,
  },
  {
    name: "static getters are invoked separately on each read",
    expected: "1:2:2",
    actual: '"1:1:1"',
    body: `let reads = 0; class Target { static get value() { return ++reads; } } return Target.value + ':' + Target.value + ':' + reads;`,
  },
  {
    name: "static getters are available during preceding field initialization",
    expected: "field|get:7",
    actual: '"field|get:undefined"',
    body: `const trace = []; class Target { static first = (trace.push('field'), this.value); static get value() { trace.push('get'); return 7; } } return trace.join('|') + ':' + Target.first;`,
  },
  {
    name: "throwing static getter bodies stay dormant until read",
    expected: "defined",
    actual: '"get|defined"',
    body: `const trace = []; try { class Target { static get value() { trace.push('get'); throw 'getter'; } } trace.push('defined'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
  {
    name: "a static field replaces an earlier getter without invoking it",
    expected: ":7",
    actual: '"get:1"',
    body: `const trace = []; class Target { static get value() { trace.push('get'); return 1; } static value = 7; } return trace.join('|') + ':' + Target.value;`,
  },
  {
    name: "a static field also replaces a later getter definition",
    expected: ":7",
    actual: '"get:1"',
    body: `const trace = []; class Target { static value = 7; static get value() { trace.push('get'); return 1; } } return trace.join('|') + ':' + Target.value;`,
  },
  {
    name: "assignments in static blocks call the class setter",
    expected: "set:7",
    actual: '""',
    body: `const trace = []; class Target { static set value(value) { trace.push('set:' + value); } static { this.value = 7; } } return trace.join('|');`,
  },
  {
    name: "inherited static getters receive the derived class",
    expected: 7,
    actual: "1",
    body: `class Base { static own = 1; static get value() { return this.own; } } class Child extends Base { static own = 7; } return Child.value;`,
  },
  {
    name: "static field super access reads the base constructor",
    expected: 8,
    actual: "<any: + on dynamic values>",
    body: `class Base { static value = 7; } class Child extends Base { static value = super.value + 1; } return Child.value;`,
  },
  {
    name: "static block super methods receive the derived constructor",
    expected: 9,
    actual: "unknown(call of super outside a derived class)",
    body: `class Base { static value = 7; static read() { return this.value; } } class Child extends Base { static value = 9; static { this.result = super.read(); } } return Child.result;`,
  },
  {
    name: "static getter descriptors remain accessors",
    expected: "function:false:false",
    actual: "branch(<string> | <string>)",
    body: `class Target { static get value() { return 7; } } const descriptor = Object.getOwnPropertyDescriptor(Target, 'value'); return typeof descriptor.get + ':' + ('value' in descriptor) + ':' + descriptor.enumerable;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("preserves static fields bypassing inherited setters", () =>
  checkDifferentialCases([
    {
      name: "static fields bypass inherited setters",
      body: `const trace = []; class Base { static set value(value) { trace.push('set:' + value); } } class Child extends Base { static value = 7; } return trace.join('|') + ':' + Child.value;`,
    },
  ]));
