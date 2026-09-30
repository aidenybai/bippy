import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { evaluateLowered } from "./helpers/control-fixture.js";
import { lowerGenerators } from "../engine/scripts/lower-generators.js";

const programs = [
  {
    name: "class expression identity across suspension",
    body: "function* run() {const Reader = class {read() {return 7;}}; yield Reader; return Reader;} const iterator = run(); const first = iterator.next().value; const result = iterator.next().value === first;",
  },
  {
    name: "body function identity across suspension",
    body: "function* run() {function read() {return 7;} yield read; return read;} const iterator = run(); const first = iterator.next().value; const result = iterator.next().value === first;",
  },
  {
    name: "native method behind a function expression boundary",
    body: "function* run() {const create = function() {return {read() {const value = 7; return value;}};}; yield create().read();} const result = run().next().value;",
  },
  {
    name: "native static block behind an arrow boundary",
    body: "function* run() {const create = () => {class Reader {static {let error; try {later;} catch(caught) {error = caught.name;} const later = 7; this.result = [error, later];}} return Reader.result;}; yield create();} const result = run().next().value;",
  },
  {
    name: "generator method shadowing",
    body: "const reader = {*read() {let value = 1; {let value = 2;} yield value;}}; const result = reader.read().next().value;",
  },
  {
    name: "generator method const write",
    body: "const reader = {*read() {const value = 1; let failure; try {value = 2;} catch(error) {failure = error.name;} yield [failure, value];}}; const result = reader.read().next().value;",
  },
  {
    name: "generator loop closures across suspension",
    body: "function* run() {const reads = []; for(let index = 0; index < 3; index++) {reads.push(() => index); yield index;} return reads.map(read => read());} const iterator = run(); const result = [iterator.next().value, iterator.next().value, iterator.next().value, iterator.next().value];",
  },
  {
    name: "generator method bindings",
    body: "const reader = { *read() { const value = 7; yield value; } }; const result = reader.read().next().value;",
  },
  {
    name: "native function nested in generator",
    body: "function* run() { const read = () => {let error; try { later; } catch (caught) {error = caught.name;} const later = 7; return [error, later];}; yield read(); } const result = run().next().value;",
  },
  {
    name: "direct read",
    body: "let error; try { later; } catch (caught) { error = caught.name; } const later = 7; const result = [error, later];",
  },
  {
    name: "typeof read",
    body: "let error; try { typeof later; } catch (caught) { error = caught.name; } let later = 7; const result = [error, later];",
  },
  {
    name: "closure read",
    body: "const read = () => later; let error; try { read(); } catch (caught) { error = caught.name; } const later = 7; const result = [error, read()];",
  },
  {
    name: "assignment before let",
    body: "let error; try { later = 2; } catch (caught) { error = caught.name; } let later = 7; const result = [error, later];",
  },
  {
    name: "native factory scope",
    body: "function create() { const read = () => later; let error; try { read(); } catch (caught) { error = caught.name; } let later = 7; return [error, read()]; } const result = create();",
  },
  {
    name: "nested block shadow",
    body: "const value = 1; let error; { try { value; } catch (caught) { error = caught.name; } const value = 2; } const result = [error, value];",
  },
  {
    name: "loop scopes",
    body: "const readers = []; for (let index = 0; index < 3; index++) { readers.push(() => index); } const result = readers.map(read => read());",
  },
];

it.each(programs)(
  "preserves native lexical behavior through full lowering: $name",
  async ({ body }) => {
    const expected = await runInNewContext(`${body}; result`);
    expect(await evaluateLowered(body)).toEqual(expected);
  },
);

it.each([
  "let value = 0; for(let index = 0; index < 1; index++) {(() => index)(); const Reader = class {static {var value = 7;}};}",
  "const Reader = class { static { const later = 7; } };",
  "const Reader = class { read() { const later = 7; return later; } };",
  "const reader = {read() { const later = 7; return later; }};",
  "const Reader = class { static { function read() {} } };",
])(
  "rejects declarations that upstream regenerator would hoist out of native scopes: %s",
  async (body) => {
    await expect(
      lowerGenerators(`function* run() { ${body} yield 1; }`, "native-scope.mjs"),
    ).rejects.toThrow(
      "Generator lowering cannot preserve declarations in nested native methods or static blocks",
    );
  },
);

it.each([
  {
    source: "function* run() {class Reader {} yield Reader; return Reader;}",
    error: "Generator-local class declarations are unsupported by control lowering",
  },
  {
    source:
      'function* run() {"use strict"; function read() {return 1;} {function read() {return 2;}} yield read();}',
    error: "Generator block-scoped function declarations are unsupported by control lowering",
  },
])("rejects unsupported generator lexical storage: $source", async ({ source, error }) => {
  await expect(lowerGenerators(source, "generator-scope.mjs")).rejects.toThrow(error);
});

it.each([
  "async function run() {let value = 1; {let value = 2;} return value;}",
  "async function* run() {yield 1;}",
  "const run = async () => 1;",
  "const reader = {async read() {return 1;}};",
])("rejects unsupported native async lowering: %s", async (source) => {
  await expect(lowerGenerators(source, "native-async.mjs")).rejects.toThrow(
    "Native async functions are unsupported by control lowering",
  );
});

it.each(["const", "let"])(
  "preserves a declared native class capture's %s TDZ",
  async (declaration) => {
    expect(
      await evaluateLowered(`
    class Reader { static read() { return later; } }
    const binding = getNativeCaptures(Reader).bindings.find(binding => binding.name === 'later');
    let error;
    try { binding.get(); } catch (caught) { error = caught.name; }
    ${declaration} later = 7;
    const result = [error, binding.get()];
  `),
    ).toEqual(["ReferenceError", 7]);
  },
);

it("rejects uninitialized native captures before owner capture and preserves the pause", async () => {
  expect(
    await evaluateLowered(`
    class Reader { static read() {return later;} }
    function* run() {yield 'pause'; return Reader.read();}
    const iterator = run();
    iterator.next();
    let ownerCalls = 0, failure;
    const owner = {capture() {ownerCalls++; return {restore() {}};}};
    try {captureControl(iterator, owner);} catch (error) {failure = error.name;}
    const callsBeforeInitialization = ownerCalls;
    const later = 7;
    const saved = captureControl(iterator, owner);
    saved.restore();
    const result = [failure, callsBeforeInitialization, ownerCalls, iterator.next().value];
  `),
  ).toEqual(["ReferenceError", 0, 1, 7]);
});

it("does not expose a setter for a native const with an illegal assignment", async () => {
  expect(
    await evaluateLowered(`
    const value = 1;
    const change = () => { value = value + 1; };
    const binding = getNativeCaptures(change).bindings.find(binding => binding.name === 'value');
    let error;
    try { change(); } catch (caught) { error = caught.name; }
    const result = [binding.set === undefined, binding.get(), error];
  `),
  ).toEqual([true, 1, "TypeError"]);
});
