import { expect, it } from "vitest";
import { createConcreteRuntime } from "../src/index.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

const evaluateBoth = async (source: string) => {
  const runtime = await createConcreteRuntime();
  const native = createNativeRuntime();
  try {
    expect(runtime.readString(source)).toBe(native.evaluate(source));
  } finally {
    runtime.dispose();
  }
};

it("matches V8 for the fixed substr scalar and UTF-16 matrix", async () => {
  const indices = [
    "undefined",
    "null",
    "false",
    "true",
    "-Infinity",
    "Infinity",
    "NaN",
    "-0",
    "0",
    "-1",
    "1",
    "2.8",
    "-2.8",
    "'2'",
    "-100",
    "100",
    "1n",
    "Symbol()",
  ];
  const expressions: string[] = [];
  for (const string of ["", "abc", "a\ud800\udfffz"])
    for (const start of indices)
      for (const length of indices)
        expressions.push(
          `(() => { try { return ['normal', String.prototype.substr.call(${JSON.stringify(string)}, ${start}, ${length})]; } catch(error) { return ['throw', error.name]; } })()`,
        );
  expect(expressions).toHaveLength(972);
  await evaluateBoth(`JSON.stringify([${expressions.join(",")}])`);
}, 30_000);

it.each([
  `JSON.stringify(Object.getOwnPropertyDescriptors(String.prototype).substr, (key, value) => typeof value === 'function' ? [value.name, value.length, Object.hasOwn(value, 'prototype')] : value)`,
  `JSON.stringify([String.prototype.substr.call(12345, 1, 2), String.prototype.substr.call(12n, 1), String.prototype.substr.call(true, 0, 2), 'abc'.substr()])`,
  `(() => { const events = []; const receiver = { [Symbol.toPrimitive](hint) { events.push('receiver:' + hint); return 'abc'; } }; const start = { valueOf() { events.push('start'); return 99; } }; const length = { valueOf() { events.push('length'); return 2; } }; return JSON.stringify([String.prototype.substr.call(receiver, start, length), events]); })()`,
  `(() => { const events = []; const argument = { valueOf() { events.push('argument'); throw 1; } }; const outcomes = [null, undefined, Symbol()].map(receiver => { try { String.prototype.substr.call(receiver, argument); } catch(error) { return error.name; } }); return JSON.stringify([outcomes, events]); })()`,
  `(() => { const events = []; const start = { valueOf() { events.push('start'); throw 'stop'; } }; const length = { valueOf() { events.push('length'); return 0; } }; try { 'abc'.substr(start, length); } catch(error) { events.push(error); } return JSON.stringify(events); })()`,
  `(() => { try { new String.prototype.substr(); } catch(error) { return JSON.stringify(error.name); } })()`,
])("matches native substr metadata and coercion order: %s", evaluateBoth);
