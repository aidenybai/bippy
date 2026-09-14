import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const TARGET = 'const target = { get value() { return "old"; } };';
const WRITE = 'target.value = "new"; return target.value;';
const CATCH = "catch (error) { return error.name; }";

it.each([
  {
    name: "sloppy function",
    source: `${TARGET} module.exports.run = () => { ${WRITE} };`,
    expected: "old",
  },
  {
    name: "own directive",
    source: `${TARGET} module.exports.run = () => { "use strict"; try { ${WRITE} } ${CATCH} };`,
    expected: "TypeError",
  },
  {
    name: "module directive",
    source: `"use strict"; ${TARGET} module.exports.run = () => { try { ${WRITE} } ${CATCH} };`,
    expected: "TypeError",
  },
  {
    name: "lexically inherited directive",
    source: `${TARGET} const make = () => { "use strict"; return () => { ${WRITE} }; }; const write = make(); module.exports.run = () => { try { return write(); } ${CATCH} };`,
    expected: "TypeError",
  },
  {
    name: "strict caller does not affect sloppy callee",
    source: `${TARGET} const write = () => { ${WRITE} }; module.exports.run = () => { "use strict"; return write(); };`,
    expected: "old",
  },
  {
    name: "class method",
    source: `${TARGET} class Writer { write() { ${WRITE} } } module.exports.run = () => { try { return new Writer().write(); } ${CATCH} };`,
    expected: "TypeError",
  },
  {
    name: "block string is not a directive",
    source: `${TARGET} module.exports.run = () => { if (true) { "use strict"; ${WRITE} } };`,
    expected: "old",
  },
  {
    name: "escaped string is not a use strict directive",
    source: `${TARGET} module.exports.run = () => { "use\\x20strict"; ${WRITE} };`,
    expected: "old",
  },
  {
    name: "sloppy write through strict trap",
    source: `module.exports.run = () => { let calls = 0; const proxy = new Proxy({}, { set: () => { "use strict"; calls++; return false; } }); proxy.value = "new"; return calls; };`,
    expected: 1,
  },
  {
    name: "strict CommonJS proxy write",
    source: `module.exports.run = () => { "use strict"; const proxy = new Proxy({}, { set: () => false }); try { proxy.value = "new"; return "returned"; } ${CATCH} };`,
    expected: "TypeError",
  },
])("uses lexical strictness for $name", async ({ source, expected }) => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-strict-write-scopes-"));
  const entryFile = join(rootDirectory, "entry.cts");
  writeFileSync(entryFile, source, { flag: "wx" });
  try {
    const renderer = await createStaticRenderer({ rootDirectory });
    let actual = "";
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryFile);
      if (!module) throw new Error(`Could not parse ${entryFile}`);
      const context = interpreter.createModuleContext(module);
      const exported = interpreter.evaluateModuleExport(module, "run");
      actual = describeValue(interpreter.callValue(exported, [], context, null));
      return UNDEFINED_VALUE;
    });
    const native = runInNewContext(
      `${source}\nmodule.exports.run();`,
      { module: { exports: {} } },
      { timeout: 1_000 },
    );
    expect(native).toEqual(expected);
    expect(actual).toBe(JSON.stringify(expected));
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
