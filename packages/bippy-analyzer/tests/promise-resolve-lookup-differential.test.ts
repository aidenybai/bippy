import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "all uses the captured resolve callback and the Promise receiver for every input",
    expected: "resolve:1:true|resolve:2:true|sync|done:2,4",
    actual: '"sync|done:1,2"',
    body: `
    const trace = [];
    const originalResolve = Promise.resolve;
    const resolver = { resolve(value) {
      trace.push('resolve:' + value + ':' + (this === Promise));
      Promise.resolve = () => { trace.push('replacement'); throw 'replacement'; };
      return originalResolve.call(Promise, value * 2);
    } };
    Object.defineProperty(Promise, 'resolve', { configurable: true, writable: true, value: resolver.resolve });
    Promise.all([1, 2]).then((values) => trace.push('done:' + values.join(',')), (error) => trace.push('error:' + error));
    trace.push('sync'); return () => trace.join('|');
  `,
  },
  {
    name: "all rejects when resolve lookup throws even with no inputs",
    expected: "lookup|sync|rejected:lookup",
    actual: '"lookup|sync|accepted"',
    body: `
    const trace = [];
    Object.defineProperty(Promise, 'resolve', { configurable: true, get() { trace.push('lookup'); throw 'lookup'; } });
    try { Promise.all([]).then(() => trace.push('accepted'), (error) => trace.push('rejected:' + error)); trace.push('sync'); } catch (error) { trace.push('thrown:' + error); }
    return () => trace.join('|');
  `,
  },
  {
    name: "all rejects a noncallable resolve even with no inputs",
    expected: "sync|TypeError",
    actual: '"sync|accepted"',
    body: `
    const trace = []; Promise.resolve = 7;
    Promise.all([]).then(() => trace.push('accepted'), (error) => trace.push(error.name));
    trace.push('sync'); return () => trace.join('|');
  `,
  },
  {
    name: "all with a subclass receiver constructs a subclass result",
    expected: "true|sync|1,2",
    actual: 'branch(<string> | <string> | "true|sync" | "false|sync")',
    body: `
    const trace = []; class Derived extends Promise {}
    const result = Derived.all([1, 2]); trace.push(result instanceof Derived);
    result.then((values) => trace.push(values.join(','))); trace.push('sync'); return () => trace.join('|');
  `,
  },
  {
    name: "subclass construction invokes the executor and settles reactions",
    expected: "executor|sync|value:7",
    actual: "<string: join of a list with an unknown length>",
    body: `
    const trace = []; class Derived extends Promise {}
    const result = new Derived((resolve) => { trace.push('executor'); resolve(7); });
    result.then((value) => trace.push('value:' + value)); trace.push('sync'); return () => trace.join('|');
  `,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase], true));

it.each([
  {
    name: "null species falls back to the ordinary Promise constructor",
    body: `
    const trace = []; const original = Promise.resolve(7); original.constructor = { [Symbol.species]: null };
    original.then((value) => trace.push(value)); trace.push('sync'); return () => trace.join('|');
  `,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase], true));
