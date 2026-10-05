import { afterAll, expect, it } from "vite-plus/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  getTestModes,
  getUnsupportedReason,
  metadataOf,
  parseTest262Options,
  selectTest262Files,
} from "../engine/scripts/test262-input.js";
import { runTest262Variant } from "../engine/scripts/test262-runtime.js";
import { runIsolatedTest262Variant } from "../engine/scripts/test262-process.js";

const directory = mkdtempSync(resolve(tmpdir(), "bippy-test262-runner-"));
mkdirSync(resolve(directory, "harness"));
mkdirSync(resolve(directory, "test"));
writeFileSync(
  resolve(directory, "harness/assert.js"),
  "var harnessOrder=['assert'];function assert(value){if(!value)throw new Error('assertion');}",
);
writeFileSync(resolve(directory, "harness/sta.js"), "harnessOrder.push('sta');");
writeFileSync(resolve(directory, "harness/extra.js"), "harnessOrder.push('extra');");
writeFileSync(
  resolve(directory, "harness/doneprintHandle.js"),
  "harnessOrder.push('done');globalThis.$DONE=error=>print(error?'Test262:AsyncTestFailure:'+String(error):'Test262:AsyncTestComplete');",
);
writeFileSync(resolve(directory, "harness/early-done.js"), "$DONE();");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("retains the default immediate scopes and recursive tail-call selection", () => {
  const selected = selectTest262Files(
    [
      "built-ins/Object/seal/direct.js",
      "built-ins/Object/seal/nested/other.js",
      "language/else/tco.js",
      "language/else/tco-call.js",
      "language/else/tco-case_FIXTURE.js",
      "language/other.js",
      "README.md",
    ],
    parseTest262Options([directory]),
  );
  expect(selected).toEqual({
    files: ["built-ins/Object/seal/direct.js", "language/else/tco-call.js", "language/else/tco.js"],
    discoveredFiles: 6,
    fixtureFiles: 1,
    scopeExcludedFiles: 2,
    shardExcludedFiles: 0,
    excludedFiles: 3,
    matchingFiles: 3,
  });
});

it("selects recursive scopes and exact files without prefix collisions", () => {
  expect(
    selectTest262Files(
      [
        "language/generators/a.js",
        "language/generators/nested/b.js",
        "language/generators-other/a.js",
        "built-ins/foo.js",
      ],
      parseTest262Options([
        directory,
        "--scope",
        "language/generators",
        "--scope",
        "built-ins/foo.js",
      ]),
    ).files,
  ).toEqual(["built-ins/foo.js", "language/generators/a.js", "language/generators/nested/b.js"]);
});

it("partitions all eligible files into disjoint stable shards", () => {
  const paths = Array.from({ length: 80 }, (_, index) => `language/generators/${index}.js`);
  const shards = Array.from({ length: 4 }, (_, index) =>
    selectTest262Files(
      paths,
      parseTest262Options([directory, "--all", "--shard", `${index + 1}/4`]),
    ),
  );
  const union = shards.flatMap((shard) => shard.files);
  expect(union.toSorted()).toEqual(paths.toSorted());
  expect(new Set(union).size).toBe(paths.length);
  for (const [index, shard] of shards.entries()) {
    expect(shard.shardExcludedFiles + shard.files.length).toBe(paths.length);
    expect(
      selectTest262Files(
        paths.toReversed(),
        parseTest262Options([directory, "--scope", "language", "--shard", `${index + 1}/4`]),
      ).files,
    ).toEqual(shard.files);
  }
});

it("normalizes path separators before hashing and removes fixture files", () => {
  const options = parseTest262Options([directory, "--scope", "language\\generators\\"]);
  expect(
    selectTest262Files(
      ["language\\generators\\a.js", "language/generators/helper_FIXTURE_extra.js"],
      options,
    ).files,
  ).toEqual(["language/generators/a.js"]);
});

it.each([
  [],
  [directory, "--unknown"],
  [directory, "--scope"],
  [directory, "--scope", "../outside"],
  [directory, "--scope", "/absolute"],
  [directory, "--all", "--scope", "language"],
  [directory, "--shard", "0/2"],
  [directory, "--shard", "3/2"],
  [directory, "--shard", "1"],
  [directory, "--shard", "1/2/3"],
  [directory, "--timeout", "0"],
  [directory, "--timeout", "2147483648"],
])("rejects invalid selection arguments %j", (...arguments_) => {
  expect(() => parseTest262Options(arguments_)).toThrow();
});

it.each([
  { flags: [], expected: ["sloppy", "strict"] },
  { flags: ["generated"], expected: ["sloppy", "strict"] },
  { flags: ["onlyStrict"], expected: ["strict"] },
  { flags: ["noStrict"], expected: ["sloppy"] },
  { flags: ["raw"], expected: ["sloppy"] },
  { flags: ["module", "async"], expected: ["module"] },
])("honors strictness flags $flags", ({ flags, expected }) => {
  expect(getTestModes({ flags, includes: [] })).toEqual(expected);
});

it.each(["CanBlockIsTrue", "unrecognized"])(
  "reports %s as unsupported rather than running a different test",
  (flag) => {
    expect(getUnsupportedReason("language/example.js", { flags: [flag], includes: [] })).toContain(
      flag,
    );
  },
);

it("supports async scripts but keeps ambiguous async runtime-negative tests unsupported", () => {
  expect(
    getUnsupportedReason("language/example.js", { flags: ["async"], includes: [] }),
  ).toBeUndefined();
  expect(
    getUnsupportedReason("language/example.js", {
      flags: ["async"],
      includes: [],
      negative: { phase: "runtime", type: "TypeError" },
    }),
  ).toContain("Async runtime-negative");
});

it("keeps the unsupported Intl profile visible", () => {
  expect(getUnsupportedReason("intl402/example.js", { flags: [], includes: [] })).toContain(
    "ECMA-402",
  );
});

it("preserves metadata and rejects malformed headers", () => {
  expect(
    metadataOf(
      "/*---\nflags: [onlyStrict]\nincludes: [extra.js]\nnegative: {phase: runtime, type: TypeError}\n---*/",
    ),
  ).toEqual({
    flags: ["onlyStrict"],
    includes: ["extra.js"],
    negative: { phase: "runtime", type: "TypeError" },
  });
  for (const source of [
    "no metadata",
    "/*---\nflags: false\n---*/",
    "/*---\nflags: [onlyStrict, raw]\n---*/",
    "/*---\nnegative: {phase: 1}\n---*/",
  ])
    expect(() => metadataOf(source)).toThrow();
});

it("loads default harness files and includes in the specified order", () => {
  expect(
    runTest262Variant(
      directory,
      "assert(harnessOrder.join(',')==='assert,sta,extra');",
      { flags: [], includes: ["extra.js"] },
      "sloppy",
    ),
  ).toEqual({ status: "passed" });
});

it("checks negative compilation before loading harness code", () => {
  expect(
    runTest262Variant(
      resolve(directory, "absent"),
      "const = ;",
      { flags: [], includes: [], negative: { phase: "parse", type: "SyntaxError" } },
      "strict",
    ),
  ).toEqual({ status: "passed" });
});

it("does not accept an error from the wrong phase", () => {
  expect(
    runTest262Variant(
      directory,
      "const = ;",
      { flags: [], includes: [], negative: { phase: "runtime", type: "SyntaxError" } },
      "sloppy",
    ).status,
  ).toBe("failed");
});

it("matches a thrown constructor name rather than a spoofed error name", () => {
  const metadata = {
    flags: ["raw"],
    includes: [],
    negative: { phase: "runtime", type: "TypeError" },
  };
  expect(runTest262Variant(directory, "throw {name:'TypeError'};", metadata, "sloppy").status).toBe(
    "failed",
  );
  expect(
    runTest262Variant(
      directory,
      "var error=new TypeError();error.name='Other';throw error;",
      metadata,
      "sloppy",
    ).status,
  ).toBe("passed");
});

it("drains queued jobs before completing negative runtime tests", () => {
  expect(
    runTest262Variant(
      directory,
      "Promise.resolve().then(()=>{throw 3;});throw new TypeError();",
      { flags: [], includes: [], negative: { phase: "runtime", type: "TypeError" } },
      "sloppy",
    ),
  ).toEqual({ status: "passed", unhandledRejections: 1 });
});

it("separates harness failures from test failures", () => {
  expect(
    runTest262Variant(directory, "0;", { flags: [], includes: ["missing.js"] }, "sloppy").status,
  ).toBe("harness-error");
  expect(
    runTest262Variant(directory, "assert(false);", { flags: [], includes: [] }, "sloppy").status,
  ).toBe("failed");
});

it("starts each variant in a fresh realm and leaves raw source unmodified", () => {
  for (let iteration = 0; iteration < 2; iteration++)
    expect(
      runTest262Variant(
        directory,
        "if(typeof marker!=='undefined'||typeof assert!=='undefined')throw 1;globalThis.marker=1;",
        { flags: ["raw"], includes: [] },
        "sloppy",
      ).status,
    ).toBe("passed");
  expect(
    runTest262Variant(directory, "with({}){}", { flags: [], includes: [] }, "strict").status,
  ).toBe("failed");
  expect(
    runTest262Variant(directory, "with({}){}", { flags: ["raw"], includes: [] }, "sloppy").status,
  ).toBe("passed");
});

it.each([
  { name: "fulfillment", source: "Promise.resolve().then(()=>$DONE());", status: "passed" },
  {
    name: "async await",
    source: "(async()=>{assert(await Promise.resolve(4)===4);})().then(()=>$DONE(),$DONE);",
    status: "passed",
  },
  {
    name: "async generators",
    source:
      "(async()=>{async function* values(){yield 3;}for await(const value of values())assert(value===3);})().then(()=>$DONE(),$DONE);",
    status: "passed",
  },
  {
    name: "reported rejection",
    source: "Promise.reject(new Error('failure')).catch($DONE);",
    status: "failed",
  },
  {
    name: "late failure",
    source: "$DONE();Promise.resolve().then(()=>$DONE(new Error('late')));",
    status: "failed",
  },
  {
    name: "duplicate completion",
    source: "$DONE();Promise.resolve().then(()=>$DONE());",
    status: "failed",
  },
  { name: "missing completion", source: "Promise.resolve();", status: "failed" },
  {
    name: "inexact signal",
    source: "print('Test262:AsyncTestComplete suffix');",
    status: "failed",
  },
  {
    name: "cross-realm print",
    source:
      "$262.createRealm().evalScript(\"Promise.resolve().then(()=>print('Test262:AsyncTestComplete'));\");",
    status: "passed",
  },
  {
    name: "first-argument coercion",
    source: "print({toString(){return 'Test262:AsyncTestComplete';}});",
    status: "passed",
  },
])("honors async completion for $name", ({ source, status }) => {
  expect(
    runTest262Variant(directory, source, { flags: ["async"], includes: [] }, "sloppy").status,
  ).toBe(status);
});

it("loads the async helper before test includes, but never for raw tests", () => {
  expect(
    runTest262Variant(
      directory,
      "assert(harnessOrder.join(',')==='assert,sta,done,extra');$DONE();",
      { flags: ["async"], includes: ["extra.js"] },
      "sloppy",
    ),
  ).toEqual({ status: "passed" });
  expect(
    runTest262Variant(
      directory,
      "if(typeof $DONE!=='undefined')throw 1;print('Test262:AsyncTestComplete');",
      { flags: ["raw", "async"], includes: [] },
      "sloppy",
    ),
  ).toEqual({ status: "passed" });
  expect(
    runTest262Variant(directory, "0;", { flags: ["async"], includes: ["early-done.js"] }, "sloppy")
      .status,
  ).toBe("harness-error");
});

it("tracks rejected promises by identity until handlers are attached", () => {
  const metadata = { flags: ["async"], includes: [] };
  expect(runTest262Variant(directory, "Promise.reject(3);$DONE();", metadata, "sloppy")).toEqual({
    status: "passed",
    unhandledRejections: 1,
  });
  expect(
    runTest262Variant(
      directory,
      "const promise=Promise.reject(3);Promise.resolve().then(()=>promise.catch(()=>{})).then(()=>$DONE());",
      metadata,
      "sloppy",
    ),
  ).toEqual({ status: "passed" });
  expect(
    runTest262Variant(
      directory,
      "Promise.resolve().then(()=>{throw new Error('missing done');});",
      metadata,
      "sloppy",
    ),
  ).toEqual({
    status: "failed",
    detail: "Async test did not signal completion",
    unhandledRejections: 1,
  });
});

it("bounds self-rescheduling jobs and does not mistake an early completion for quiescence", () => {
  expect(
    runTest262Variant(
      directory,
      "$DONE();const repeat=()=>Promise.resolve().then(repeat);repeat();",
      { flags: ["async"], includes: [] },
      "sloppy",
    ),
  ).toEqual({ status: "incomplete", detail: "Test262 job budget exhausted" });
});

it("carries async rejection diagnostics through the worker protocol", () => {
  const source = "/*---\nflags: [async]\n---*/\nPromise.reject(3);$DONE();";
  writeFileSync(resolve(directory, "test/async-worker.js"), source);
  expect(
    runIsolatedTest262Variant(
      directory,
      "async-worker.js",
      "sloppy",
      createHash("sha256").update(source).digest("hex"),
      10_000,
    ),
  ).toEqual({ status: "passed", unhandledRejections: 1 });
});

it("isolates worker execution, verifies source hashes, and enforces a wall deadline", () => {
  const source = "/*---\nflags: [raw]\n---*/\n42;";
  writeFileSync(resolve(directory, "test/worker.js"), source);
  const hash = createHash("sha256").update(source).digest("hex");
  expect(runIsolatedTest262Variant(directory, "worker.js", "sloppy", hash, 10_000)).toEqual({
    status: "passed",
  });
  expect(
    runIsolatedTest262Variant(directory, "worker.js", "sloppy", "changed", 10_000).status,
  ).toBe("harness-error");
  expect(runIsolatedTest262Variant(directory, "worker.js", "sloppy", hash, 1)).toEqual({
    status: "incomplete",
    detail: "Test262 worker deadline exceeded",
  });
});
