import assert from "node:assert/strict";
import { encode, type SourceMapSegment } from "@jridgewell/sourcemap-codec";
import type { Fiber } from "bippy";
import type { HooksTree, SourceFetch, SourceMap, StackFrame } from "bippy/source";
import { benchmarkCase, type BenchmarkCase, type BenchmarkContext } from "./harness.js";
import { Component, createDebugStack, createFiber, createTree, linkChildren } from "./fixtures.js";

const assertFrame = (value: unknown): void => {
  assert.ok(value && typeof value === "object");
  assert.equal(typeof Reflect.get(value, "fileName"), "string");
};
const assertFrames = (value: unknown): void => assert.ok(Array.isArray(value) && value.length > 0);

export const createSourceBenchmarks = ({ Source }: BenchmarkContext): BenchmarkCase[] => {
  const cases: BenchmarkCase[] = [];
  const add = (
    name: string,
    scenario: string,
    run: BenchmarkCase["run"],
    verify: BenchmarkCase["verify"],
    isAsync = false,
  ) =>
    cases.push(
      benchmarkCase(`${name}/${scenario}`, [`bippy/source#${name}`], run, verify, {
        async: isAsync,
      }),
    );
  const bundleUrl = "https://bench.example/bundle.js";
  const sourceContent =
    "export const MappedComponent = () => {\nconst [count, setCount] = useState(0);\nreturn count;\n};";
  const mappings: SourceMapSegment[][] = Array.from({ length: 1001 }, (_, index) => [
    [0, 0, index === 0 ? 0 : 1, 0, 0],
  ]);
  const rawMap = JSON.stringify({
    version: 3,
    names: ["MappedComponent"],
    sources: ["src/component.tsx"],
    sourcesContent: [sourceContent],
    mappings: encode(mappings),
  });
  const sourceFetch: SourceFetch = async (url) =>
    new Response(
      url.endsWith(".map") ? rawMap : "const bundled = 1;\n//# sourceMappingURL=bundle.js.map",
    );
  const parent = createFiber({ type: Component });
  const child = createFiber({ _debugOwner: parent, _debugStack: createDebugStack() });
  linkChildren(parent, [child]);
  add(
    "hasDebugStack",
    "present",
    () => Source.hasDebugStack(child),
    (value) => assert.equal(value, true),
  );
  add("getRawSource", "debug-stack-warm", () => Source.getRawSource(child), assertFrame);
  add(
    "getDefinitionFrameFromOwnedChild",
    "direct-child",
    () => Source.getDefinitionFrameFromOwnedChild(parent),
    assertFrame,
  );
  add(
    "getSource",
    "symbolicated-warm",
    () => Source.getSource(child, true, sourceFetch),
    (value) => {
      assert.ok(value && typeof value === "object");
      assert.equal(Reflect.get(value, "fileName"), "src/component.tsx");
    },
    true,
  );
  add(
    "getDisplayNameFromSource",
    "mapped-declaration",
    () => Source.getDisplayNameFromSource(parent, true, sourceFetch),
    (value) => assert.equal(value, "MappedComponent"),
    true,
  );
  const legacy = createFiber({
    _debugSource: { fileName: "src/component.tsx", lineNumber: 2, columnNumber: 1 },
  });
  add("getRawSource", "legacy-debug-source", () => Source.getRawSource(legacy), assertFrame);
  add("getSource", "legacy-debug-source", () => Source.getSource(legacy), assertFrame, true);
  add(
    "normalizeFileName",
    "webpack",
    () => Source.normalizeFileName("webpack-internal:///(app-pages-browser)/./src/component.tsx"),
    (value) => assert.equal(typeof value, "string"),
  );
  add(
    "isSourceFile",
    "tsx",
    () => Source.isSourceFile("/src/component.tsx"),
    (value) => assert.equal(value, true),
  );

  for (const size of [10, 1000]) {
    const stack = createDebugStack(size).stack ?? "";
    add(
      "parseStack",
      `v8-${size}`,
      () => Source.parseStack(stack),
      (value) => {
        assert.ok(Array.isArray(value));
        assert.equal(value.length, size + 2);
      },
    );
    const safari = Array.from(
      { length: size },
      (_, index) => `Component${index}@https://bench.example/bundle.js:${index + 1}:1`,
    ).join("\n");
    add(
      "parseStack",
      `safari-${size}`,
      () => Source.parseStack(safari),
      (value) => {
        assert.ok(Array.isArray(value));
        assert.equal(value.length, size);
      },
    );
    add(
      "formatOwnerStack",
      `frames-${size}`,
      () => Source.formatOwnerStack(stack),
      (value) => {
        assert.equal(typeof value, "string");
        assert.ok(String(value).includes("Component0"));
      },
    );
  }
  for (const depth of [10, 100]) {
    const tree = createTree(depth, "deep");
    tree.fibers.forEach((fiber, index) => {
      fiber._debugOwner = index === 0 ? tree.root.current : tree.fibers[index - 1];
      fiber._debugStack = createDebugStack();
      const ThrowingComponent = () => {
        throw new Error("benchmark frame");
      };
      Object.defineProperty(ThrowingComponent, "name", { value: `Ancestor${index}` });
      fiber.type = ThrowingComponent;
    });
    const leaf = tree.fibers[depth - 1];
    add(
      "getRawOwnerStack",
      `owners-${depth}-warm`,
      () => Source.getRawOwnerStack(leaf),
      assertFrames,
    );
    add(
      "getOwnerStack",
      `owners-${depth}-symbolicated`,
      () => Source.getOwnerStack(leaf, true, sourceFetch),
      assertFrames,
      true,
    );
    add(
      "getFallbackParentStack",
      `parents-${depth}-warm`,
      () => Source.getFallbackParentStack(leaf),
      (value) => assert.ok(typeof value === "string" && value.includes("Ancestor")),
    );
    add(
      "getParentStack",
      `parents-${depth}-symbolicated`,
      () => Source.getParentStack(leaf, true, sourceFetch),
      assertFrames,
      true,
    );
  }
  let coldFibers: Fiber[] = [];
  cases.push(
    benchmarkCase(
      "getRawSource/debug-stack-cold",
      ["bippy/source#getRawSource"],
      (iteration) => Source.getRawSource(coldFibers[iteration]),
      assertFrame,
      {
        prepare: (iterations) => {
          coldFibers = Array.from({ length: iterations }, () =>
            createFiber({ _debugOwner: parent, _debugStack: createDebugStack() }),
          );
        },
        maxIterations: 128,
      },
    ),
  );
  const wide = createTree(1000, "wide");
  wide.fibers[999]._debugOwner = wide.root.current;
  wide.fibers[999]._debugStack = createDebugStack();
  add(
    "getDefinitionFrameFromOwnedChild",
    "wide-1000-tail",
    () => Source.getDefinitionFrameFromOwnedChild(wide.root.current),
    assertFrame,
  );

  for (const size of [100, 10000]) {
    const sourceMap: SourceMap = {
      version: 3,
      sources: ["src/component.tsx"],
      names: ["first", "last"],
      sourcesContent: [sourceContent],
      mappings: Array.from({ length: size }, (_, index) => [
        [0, 0, index, 0, index === size - 1 ? 1 : 0],
      ]),
    };
    add(
      "getSourceFromSourceMap",
      `lines-${size}`,
      () => Source.getSourceFromSourceMap(sourceMap, size, 0),
      assertFrame,
    );
    add(
      "getSourceFromSourceMapByFunctionName",
      `tail-${size}`,
      () => Source.getSourceFromSourceMapByFunctionName(sourceMap, "last"),
      (value) => {
        assertFrame(value);
        assert.equal(Reflect.get(Object(value), "lineNumber"), size);
      },
    );
    const segmented: SourceMap = {
      ...sourceMap,
      mappings: [Array.from({ length: size }, (_, index) => [index, 0, 0, index])],
    };
    add(
      "getSourceFromSourceMap",
      `segments-${size}`,
      () => Source.getSourceFromSourceMap(segmented, 1, size - 1),
      assertFrame,
    );
    const contentMap: SourceMap = {
      ...sourceMap,
      sources: Array.from({ length: size }, (_, index) => `source${index}.tsx`),
      sourcesContent: Array.from({ length: size }, () => sourceContent),
    };
    add(
      "getSourceContentFromSourceMap",
      `tail-${size}`,
      () => Source.getSourceContentFromSourceMap(contentMap, `source${size - 1}.tsx`),
      (value) => assert.equal(value, sourceContent),
    );
  }
  const indexed: SourceMap = {
    version: 3,
    sources: [],
    mappings: [],
    sections: Array.from({ length: 1000 }, (_, index) => ({
      offset: { line: index, column: 0 },
      map: { version: 3, sources: ["src/component.tsx"], mappings: [[[0, 0, 0, 0]]] },
    })),
  };
  add(
    "getSourceFromSourceMap",
    "indexed-1000-tail",
    () => Source.getSourceFromSourceMap(indexed, 1000, 0),
    assertFrame,
  );
  const assertMap = (value: unknown): void => {
    assert.ok(value && typeof value === "object");
    const decodedMappings: unknown = Reflect.get(value, "mappings");
    assert.ok(Array.isArray(decodedMappings) && decodedMappings.length === 1001);
  };
  add(
    "getSourceMap",
    "in-memory-fetch-decode-cold",
    () => Source.getSourceMap(bundleUrl, false, sourceFetch),
    assertMap,
    true,
  );
  add(
    "getSourceMap",
    "cache-hit",
    () => Source.getSourceMap(bundleUrl, true, sourceFetch),
    assertMap,
    true,
  );
  const frames: StackFrame[] = Array.from({ length: 100 }, () => ({
    fileName: bundleUrl,
    lineNumber: 1,
    columnNumber: 0,
  }));
  const assertSymbolicated = (value: unknown): void => {
    assert.ok(Array.isArray(value));
    assert.equal(value.length, frames.length);
    assert.ok(value.every((frame) => frame.isSymbolicated === true));
  };
  add(
    "symbolicateStack",
    "100-frames-warm",
    () => Source.symbolicateStack(frames, true, sourceFetch),
    assertSymbolicated,
    true,
  );
  add(
    "symbolicateStack",
    "100-frames-cold-deduplicated",
    () => Source.symbolicateStack(frames, true, async (url) => sourceFetch(url)),
    assertSymbolicated,
    true,
  );
  for (const size of [10, 100]) {
    const hooks: HooksTree = Array.from({ length: size }, (_, index) => ({
      id: index,
      name: "State",
      value: 0,
      isStateEditable: true,
      subHooks: [],
      debugInfo: null,
      hookSource: {
        fileName: bundleUrl,
        lineNumber: index + 2,
        columnNumber: 1,
        functionName: "MappedComponent",
      },
    }));
    add(
      "parseHookNames",
      `hooks-${size}`,
      () => Source.parseHookNames(hooks, sourceFetch),
      (value) => {
        assert.ok(value instanceof Map);
        assert.equal(value.size, size);
        assert.ok([...value.values()].every((name) => name === "count"));
      },
      true,
    );
  }
  return cases;
};
