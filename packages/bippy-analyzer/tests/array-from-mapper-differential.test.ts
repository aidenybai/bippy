import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const constructors = ["Array", "Uint8Array"];
const binaryConstructors = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
];

it.each(binaryConstructors)("does not classify %s as an ordinary array", (constructor) =>
  checkDifferentialCases([
    {
      name: `${constructor}/array brand`,
      body: `const value = new ${constructor}(2); return Array.isArray(value) + ':' + Array.isArray([]);`,
    },
  ]),
);
it("retains the third callback argument for Array.prototype.map", () =>
  checkDifferentialCases([
    {
      name: "Array.prototype.map callback arguments",
      body: `const source = [1,2]; return source.map(function(value,index,receiver) {return arguments.length + ':' + (receiver === source);}).join(',');`,
    },
  ]));

const receivers = [
  "undefined",
  "null",
  "{tag:'context'}",
  "7",
  "'text'",
  "true",
  "1n",
  "Symbol.for('context')",
];
const invalidMappers = ["5", "null", "{}", "true", "'mapper'", "Symbol('mapper')", "1n"];
const sources = [
  { name: "empty", expression: "[]" },
  { name: "nonempty", expression: "[1,2]" },
  {
    name: "iterator lookup",
    expression: "{get [Symbol.iterator]() {trace.push('lookup'); return () => [1].values();}}",
  },
];
const cases: DifferentialCase[] = constructors
  .flatMap((constructor) => [
    ...receivers.map((receiver) => ({
      name: `${constructor}/receiver=${receiver}`,
      body: `const trace = []; const context = ${receiver}; const source = firstValue ? [1] : [2,3]; const result = ${constructor}.from(source, function(value,index) { trace.push(arguments.length + ':' + Object.is(this,context) + ':' + typeof arguments[2]); return value + index; }, context); if (secondValue) trace.push('tail'); return Array.isArray(result) + '|' + result.join(',') + '|' + trace.join(',');`,
    })),
    {
      name: `${constructor}/arrow retains lexical receiver and arguments`,
      body: `const owner = {read() {return ${constructor}.from(firstValue ? [1] : [2,3], (value,index) => value + index + (this === owner ? arguments.length : 100), {tag:'ignored'});}}; const result = owner.read(4,5,6,7); return result.join(',') + ':' + (secondValue ? 'B' : 'A');`,
    },
    {
      name: `${constructor}/bound mapper`,
      body: `const trace = []; const context = {tag:'bound'}; const mapper = function(leading,value,index) {trace.push(arguments.length + ':' + (this === context) + ':' + leading); return value + index;}.bind(context,7); const result = ${constructor}.from(firstValue ? [1] : [2,3], mapper, {tag:'ignored'}); if (secondValue) trace.push('tail'); return result.join(',') + '|' + trace.join(',');`,
    },
    {
      name: `${constructor}/selected mapper and omitted receiver`,
      body: `const trace = []; const mapper = firstValue ? function(value,index) {trace.push(arguments.length + ':' + (this === undefined)); return value + index;} : undefined; const result = ${constructor}.from([1,2], mapper); if (secondValue) trace.push('tail'); return Array.isArray(result) + '|' + result.join(',') + '|' + trace.join(',');`,
    },
    {
      name: `${constructor}/optional callback preserves closure and receiver effects`,
      body: `const source = [1]; if (firstValue) source.push(2); const context = {count:0}; const makeMapper = () => {let count = 0; return {mapper: function() {count++; this.count++; return 1;}, read: () => count};}; const state = makeMapper(); const result = ${constructor}.from(source, state.mapper, context); if (secondValue) context.count += 10; return [state.read(), context.count, result.join(',')].join('|');`,
    },
    ...invalidMappers.flatMap((mapper) =>
      sources.map((source) => ({
        name: `${constructor}/invalid=${mapper}/source=${source.name}`,
        body: `const trace = []; const source = ${source.expression}; const mapper = firstValue ? ${mapper} : undefined; let result; try { result = 'ok:' + ${constructor}.from(source,mapper).join(','); } catch(error) { result = error.name + ':' + error.message; } if (secondValue) trace.push('tail'); return result + '|' + trace.join(',');`,
      })),
    ),
  ])
  .map((testCase) => ({
    ...testCase,
    body: `const firstValue = first; const secondValue = second; ${testCase.body}`,
  }));

it.each(cases)("matches native mapper semantics and pinned replay for $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete mapper inputs for $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first = ${!!(index & 2)}; const second = ${!!(index & 1)}; ${testCase.body}`,
    })),
  ),
);
