import { afterAll, expect, it } from "vite-plus/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { runTest262Variant } from "../engine/scripts/test262-runtime.js";
import { runIsolatedTest262Variant } from "../engine/scripts/test262-process.js";
import {
  metadataOf,
  test262ModuleLimit,
  test262ModuleByteLimit,
  type TestMetadata,
} from "../engine/scripts/test262-input.js";

interface ModuleCaseOptions {
  flags?: string[];
  negative?: TestMetadata["negative"];
  fixtures?: Record<string, string>;
  path?: string;
}

const root = mkdtempSync(resolve(tmpdir(), "bippy-test262-modules-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const createCase = (
  source: string,
  fixtures: Record<string, string> = {},
  path = "entry.js",
): string => {
  const directory = mkdtempSync(resolve(root, "case-"));
  mkdirSync(resolve(directory, "harness"));
  writeFileSync(
    resolve(directory, "harness/assert.js"),
    "function assert(value){if(!value)throw new Error('assertion');}",
  );
  writeFileSync(
    resolve(directory, "harness/sta.js"),
    "function $DONOTEVALUATE(){throw new Error('unexpected evaluation');}",
  );
  writeFileSync(
    resolve(directory, "harness/doneprintHandle.js"),
    "globalThis.$DONE=error=>print(error?'Test262:AsyncTestFailure:'+String(error):'Test262:AsyncTestComplete');",
  );
  for (const [name, contents] of Object.entries({ ...fixtures, [path]: source })) {
    const filename = resolve(directory, "test", name);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, contents);
  }
  return directory;
};

const runModule = (source: string, options: ModuleCaseOptions = {}) => {
  const path = options.path ?? "entry.js";
  return runTest262Variant(
    createCase(source, options.fixtures, path),
    source,
    { flags: options.flags ?? ["module"], includes: [], negative: options.negative },
    "module",
    path,
  );
};

it("runs modules once, implicitly strict, without prepending a directive", () => {
  expect(
    runModule(
      "#!/usr/bin/env node\nvar local=3;assert(this===undefined);assert(globalThis.local===undefined);export{local};",
    ),
  ).toEqual({ status: "passed" });
});

it("keeps self-imports attached to the entry module and preserves live bindings", () => {
  expect(
    runModule(
      "export let value=1;import{value as same}from './entry.js';assert(same===1);value=2;assert(same===2);",
    ),
  ).toEqual({ status: "passed" });
});

it("resolves nested fixtures relative to their referrer and records source hashes", () => {
  const fixture = "export let value=1;export const update=()=>value++;";
  const result = runModule(
    "import{value,update}from './nested/reexport_FIXTURE.js';assert(value===1);update();assert(value===2);",
    {
      fixtures: {
        "nested/reexport_FIXTURE.js": "export{value,update}from './value_FIXTURE.js';",
        "nested/value_FIXTURE.js": fixture,
      },
    },
  );
  expect(result.status).toBe("passed");
  expect(result.moduleSources).toContainEqual({
    path: "nested/value_FIXTURE.js",
    sourceHash: createHash("sha256").update(fixture).digest("hex"),
  });
});

it("loads diamond dependencies once", () => {
  expect(
    runModule(
      "import{token as left}from './left.js';import{token as right}from './right.js';assert(left===right);assert(globalThis.loads===1);",
      {
        fixtures: {
          "left.js": "export{token}from './shared.js';",
          "right.js": "export{token}from './shared.js';",
          "shared.js": "globalThis.loads=(globalThis.loads||0)+1;export const token={};",
        },
      },
    ).status,
  ).toBe("passed");
});

it("links cycles before evaluating them", () => {
  expect(
    runModule(
      "import{read}from './cycle.js';export let value=3;assert(read()===3);value=4;assert(read()===4);",
      { fixtures: { "cycle.js": "import{value}from './entry.js';export const read=()=>value;" } },
    ).status,
  ).toBe("passed");
});

it("does not load dependencies for a negative entry parse", () => {
  expect(
    runModule("import './missing.js';export const =;", {
      negative: { phase: "parse", type: "SyntaxError" },
    }),
  ).toEqual({ status: "passed" });
});

it("matches link errors without evaluating either module body", () => {
  expect(
    runModule("import{missing}from './fixture.js';$DONOTEVALUATE();", {
      fixtures: { "fixture.js": "export const value=1;throw new Error('dependency body');" },
      negative: { phase: "resolution", type: "SyntaxError" },
    }).status,
  ).toBe("passed");
  expect(
    runModule("$DONOTEVALUATE();", { negative: { phase: "resolution", type: "Error" } }).status,
  ).toBe("failed");
});

it("does not match a dependency parse error as a runtime error", () => {
  expect(
    runModule("import './invalid.js';", {
      fixtures: { "invalid.js": "const = ;" },
      negative: { phase: "runtime", type: "SyntaxError" },
    }).status,
  ).toBe("failed");
});

it.each([
  "throw new TypeError();",
  "await Promise.resolve();throw new TypeError();",
  "await Promise.reject(new TypeError());",
])("observes module evaluation rejection: %s", (source) => {
  expect(runModule(source, { negative: { phase: "runtime", type: "TypeError" } })).toEqual({
    status: "passed",
  });
});

it("waits for top-level await and dependency evaluation", () => {
  expect(
    runModule("import{value}from './await.js';assert(value===4);await Promise.resolve();", {
      fixtures: { "await.js": "export const value=await Promise.resolve(4);" },
    }).status,
  ).toBe("passed");
});

it("does not accept DONE while module evaluation remains pending", () => {
  expect(runModule("$DONE();await new Promise(()=>{});", { flags: ["module", "async"] })).toEqual({
    status: "incomplete",
    detail: "Module runtime did not settle",
  });
  expect(runModule("await Promise.resolve();$DONE();", { flags: ["module", "async"] })).toEqual({
    status: "passed",
  });
});

it("uses the same module cache for static and dynamic imports", () => {
  expect(
    runModule(
      "import*as first from './fixture.js';const second=await import('./fixture.js');assert(first===second);",
      { fixtures: { "fixture.js": "export const value={};" } },
    ).status,
  ).toBe("passed");
});

it("supports dynamic imports from scripts without sharing module identities across realms", () => {
  const source =
    "Promise.all([import('./fixture.js'),import('./fixture.js'),$262.createRealm().evalScript(\"import('./fixture.js')\")]).then(([first,same,other])=>{assert(first===same);assert(first.token!==other.token);$DONE();},$DONE);";
  const directory = createCase(source, { "fixture.js": "export const token={};" });
  expect(
    runTest262Variant(directory, source, { flags: ["async"], includes: [] }, "sloppy").status,
  ).toBe("passed");
});

it("delivers dynamic dependency parse errors as promise rejections", () => {
  const source =
    "import('./bad.js').then(()=>$DONE(new Error('unexpected success')),error=>{assert(error instanceof SyntaxError);$DONE();});";
  const directory = createCase(source, { "bad.js": "const =;" });
  expect(
    runTest262Variant(directory, source, { flags: ["async"], includes: [] }, "sloppy").status,
  ).toBe("passed");
});

it("rejects unresolved module requests without evaluating the importing body", () => {
  expect(
    runModule("import './missing.js';$DONOTEVALUATE();", {
      negative: { phase: "resolution", type: "TypeError" },
    }).status,
  ).toBe("passed");
  expect(
    runModule(
      "try{await import('unmapped-package');}catch(error){assert(error instanceof TypeError);}",
    ).status,
  ).toBe("passed");
  expect(
    runModule("export{};if(typeof assert!=='undefined')throw 1;", { flags: ["module", "raw"] })
      .status,
  ).toBe("passed");
});

it("rejects unsupported module kinds instead of parsing them as JavaScript", () => {
  expect(
    runModule("await import('./fixture.js?query');", { fixtures: { "fixture.js": "export{};" } })
      .status,
  ).toBe("unsupported");
  expect(
    runModule("import value from './data.json' with {type:'json'};", {
      fixtures: { "data.json": "{}" },
    }).status,
  ).toBe("unsupported");
  expect(
    runModule("import './fixture.js?query';", { fixtures: { "fixture.js": "export{};" } }).status,
  ).toBe("unsupported");
  expect(runModule("import source value from '<module source>'; ").status).toBe("unsupported");
});

it("rejects traversal and symlinks outside the test tree", () => {
  const source = "import './escape.js';";
  const directory = createCase(source);
  const outside = resolve(directory, "outside.js");
  writeFileSync(outside, "export{};");
  symlinkSync(outside, resolve(directory, "test/escape.js"));
  expect(
    runTest262Variant(directory, source, { flags: ["module"], includes: [] }, "module").status,
  ).toBe("unsupported");
  expect(
    runTest262Variant(
      directory,
      "import '../outside.js';",
      { flags: ["module"], includes: [] },
      "module",
    ).status,
  ).toBe("unsupported");
});

it("bounds module count and source size", () => {
  const fixtures: Record<string, string> = {};
  let source = "";
  for (let index = 0; index <= test262ModuleLimit; index++) {
    fixtures[`dependency-${index}.js`] = "export{};";
    source += `import './dependency-${index}.js';\n`;
  }
  expect(runModule(source, { fixtures }).status).toBe("incomplete");
  expect(
    runModule("import './big.js';", {
      fixtures: { "big.js": " ".repeat(test262ModuleByteLimit + 1) },
    }).status,
  ).toBe("incomplete");
});

it("validates module mode and preserves dependency evidence across isolated workers", () => {
  const source =
    "/*---\nflags: [module]\n---*/\nimport{value}from './fixture.js';assert(value===2);";
  const directory = createCase(source, { "fixture.js": "export const value=2;" });
  expect(
    runTest262Variant(directory, source, { flags: ["module"], includes: [] }, "sloppy").status,
  ).toBe("harness-error");
  const result = runIsolatedTest262Variant(
    directory,
    "entry.js",
    "module",
    createHash("sha256").update(source).digest("hex"),
    10_000,
  );
  expect(result.status).toBe("passed");
  expect(result.moduleSources?.length).toBe(1);
  expect(() => metadataOf("/*---\nflags: [module, noStrict]\n---*/")).toThrow("Conflicting module");
});
