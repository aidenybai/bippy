import assert from "node:assert/strict";
import { it } from "vite-plus/test";
import {
  createStackParser,
  extractLocation,
  parseStack,
} from "../../../bippy/src/source/parse-stack.js";
import {
  getSourceContentFromSourceMap,
  getSourceFromSourceMapByFunctionName,
  type SourceMap,
} from "../../../bippy/src/source/symbolication.js";

const getPreviousLocation = (
  location: string,
): [string, string | undefined, string | undefined] => {
  if (!location.includes(":")) return [location, undefined, undefined];
  const sanitized =
    location.startsWith("(") && /:\d+\)$/.test(location) ? location.slice(1, -1) : location;
  const parts = /(.+?)(?::(\d+))?(?::(\d+))?$/.exec(sanitized);
  return parts
    ? [parts[1], parts[2] || undefined, parts[3] || undefined]
    : [sanitized, undefined, undefined];
};

it("preserves location extraction for ports, route groups, empty prefixes, and line terminators", () => {
  const prefixes = [
    "",
    ":",
    "::",
    "file",
    "http://localhost:3000/(route)/file.tsx",
    "C:\\src\\file.tsx",
    "a\nb",
    "a\rb",
    "a\u2028b",
    "a\u2029b",
    "a:".repeat(1000),
  ];
  const suffixes = ["", ":", ":0", ":01", ":1:2", ":1:2:3", ":-1:2", ":1:", ":1:2\n", ":١:٢"];
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      for (const location of [prefix + suffix, `(${prefix}${suffix})`])
        assert.deepEqual(extractLocation(location), getPreviousLocation(location), location);
    }
  }
  const characters = ["a", ":", "0", "1", "(", ")", "\n"];
  for (let combination = 0; combination < characters.length ** 5; combination++) {
    let remaining = combination;
    let location = "";
    for (let index = 0; index < 5; index++) {
      location += characters[remaining % characters.length];
      remaining = Math.floor(remaining / characters.length);
    }
    assert.deepEqual(extractLocation(location), getPreviousLocation(location), location);
  }
});

it("reuses parsed frames only inside one inspection parser and preserves mixed stack formats", () => {
  const parseCached = createStackParser();
  const shared = "    at Shared (http://localhost:3000/(route)/file.tsx:2:3)";
  const first = parseCached(`Error\n    at First (first.ts:1:2)\n${shared}`);
  const second = parseCached(`Error\n    at Second (second.ts:3:4)\n${shared}`);
  assert.equal(first[1], second[1]);
  assert.notEqual(first[1], createStackParser()(shared)[0]);
  for (const stack of [
    shared,
    "hook@file.ts:1:2",
    "Error\nplain",
    "[native code]",
    `hook@file.ts:1:2\n${shared}`,
    "    at eval (eval at Render (file.ts:1:2), <anonymous>:3:4)",
    "    in Component",
    "",
  ]) {
    assert.deepEqual(parseCached(stack), parseStack(stack, { includeInElement: false }));
  }
  const frames = parseStack(shared);
  frames[0].fileName = "mutated";
  assert.equal(parseStack(shared)[0].fileName, "http://localhost:3000/(route)/file.tsx");
});

it("does not materialize every ignored candidate when resolving a function name", () => {
  let nameReads = 0;
  const names = new Proxy(["Target"], {
    get: (target, property, receiver) => {
      if (property === "0") nameReads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const sourceMap: SourceMap = {
    version: 3,
    names,
    sources: ["vendor.tsx", "app.tsx"],
    ignoredSourceIndices: new Set([0]),
    mappings: Array.from({ length: 1000 }, (_, index) => [[0, index === 999 ? 1 : 0, index, 0, 0]]),
  };
  assert.equal(getSourceFromSourceMapByFunctionName(sourceMap, "Target")?.fileName, "app.tsx");
  assert.equal(nameReads, 3);
  nameReads = 0;
  sourceMap.mappings[999] = [[0, 0, 999, 0, 0]];
  assert.equal(getSourceFromSourceMapByFunctionName(sourceMap, "Target")?.lineNumber, 1);
  assert.equal(nameReads, 2);
});

it("keeps reverse source lookups live and preserves first duplicate semantics", () => {
  const sourceMap: SourceMap = {
    version: 3,
    mappings: [
      [
        [0, 0, 0, 0, 0],
        [1, 1, 1, 0, 0],
      ],
    ],
    names: ["Component"],
    sources: ["same.tsx", "same.tsx"],
    sourcesContent: [null, "second"],
  };
  assert.equal(getSourceContentFromSourceMap(sourceMap, "same.tsx"), null);
  sourceMap.sourcesContent = ["first", "second"];
  assert.equal(getSourceContentFromSourceMap(sourceMap, "same.tsx"), "first");
  sourceMap.sources[0] = "renamed.tsx";
  assert.equal(getSourceContentFromSourceMap(sourceMap, "same.tsx"), "second");
  assert.equal(
    getSourceFromSourceMapByFunctionName(sourceMap, "Component")?.fileName,
    "renamed.tsx",
  );
  sourceMap.ignoredSourceIndices = new Set([0]);
  assert.equal(getSourceFromSourceMapByFunctionName(sourceMap, "Component")?.fileName, "same.tsx");
  sourceMap.mappings[0][1] = [1];
  assert.equal(
    getSourceFromSourceMapByFunctionName(sourceMap, "Component")?.fileName,
    "renamed.tsx",
  );
  sourceMap.names = ["Updated"];
  assert.equal(getSourceFromSourceMapByFunctionName(sourceMap, "Component"), null);
  assert.equal(getSourceFromSourceMapByFunctionName(sourceMap, "Updated")?.functionName, "Updated");
  sourceMap.sourcesContent[1] = "updated";
  assert.equal(getSourceContentFromSourceMap(sourceMap, "same.tsx"), "updated");
});
