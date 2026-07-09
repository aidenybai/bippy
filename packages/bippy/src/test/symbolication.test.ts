import { encode } from "@jridgewell/sourcemap-codec";
import { describe, expect, it } from "vitest";
import type { StackFrame } from "../source/parse-stack.js";
import {
  getSourceFromSourceMap,
  getSourceMap,
  getSourceMapImpl,
  sourceMapCache,
  symbolicateStack,
  type SourceMap,
} from "../source/symbolication.js";

const createStandardSourceMap = (overrides?: Partial<SourceMap>): SourceMap => ({
  file: "bundle.js",
  mappings: [
    [
      [0, 0, 0, 0],
      [10, 0, 1, 4],
      [20, 0, 2, 8],
    ],
  ],
  names: [],
  sources: ["src/app.tsx"],
  sourcesContent: ["const value = 1;"],
  version: 3,
  ...overrides,
});

describe("getSourceFromSourceMap", () => {
  it("resolves the segment at an exact column", () => {
    const result = getSourceFromSourceMap(createStandardSourceMap(), 1, 10);
    expect(result).toEqual({ columnNumber: 4, fileName: "src/app.tsx", lineNumber: 2 });
  });

  it("resolves the last segment at or before the column", () => {
    const result = getSourceFromSourceMap(createStandardSourceMap(), 1, 15);
    expect(result?.lineNumber).toBe(2);
  });

  it("resolves the last segment when the column is past all segments", () => {
    const result = getSourceFromSourceMap(createStandardSourceMap(), 1, 100);
    expect(result?.lineNumber).toBe(3);
  });

  it("returns null when the column is before all segments after the first", () => {
    const sourceMap = createStandardSourceMap({ mappings: [[[5, 0, 0, 0]]] });
    expect(getSourceFromSourceMap(sourceMap, 1, 2)).toBeNull();
  });

  it("returns null for out-of-range lines", () => {
    expect(getSourceFromSourceMap(createStandardSourceMap(), 0, 0)).toBeNull();
    expect(getSourceFromSourceMap(createStandardSourceMap(), 99, 0)).toBeNull();
  });

  it("returns null for lines without mappings", () => {
    const sourceMap = createStandardSourceMap({ mappings: [[]] });
    expect(getSourceFromSourceMap(sourceMap, 1, 0)).toBeNull();
  });

  it("returns null for segments without source info", () => {
    const sourceMap = createStandardSourceMap({ mappings: [[[0]]] });
    expect(getSourceFromSourceMap(sourceMap, 1, 0)).toBeNull();
  });

  it("returns null for four-field segments with holes", () => {
    const malformedSegment: number[] = [0, 0];
    malformedSegment.length = 4;
    const sourceMap = createStandardSourceMap({
      mappings: [[malformedSegment]] as unknown as SourceMap["mappings"],
    });
    expect(getSourceFromSourceMap(sourceMap, 1, 0)).toBeNull();
  });

  it("returns null when the segment points at a missing source", () => {
    const sourceMap = createStandardSourceMap({ sources: [] });
    expect(getSourceFromSourceMap(sourceMap, 1, 0)).toBeNull();
  });

  it("resolves through index map sections with line offsets", () => {
    const sourceMap = createStandardSourceMap({
      sections: [
        {
          map: {
            mappings: [[[0, 0, 0, 0]]],
            sources: ["src/first.tsx"],
            version: 3,
          },
          offset: { column: 0, line: 0 },
        },
        {
          map: {
            mappings: [[[0, 0, 5, 0]]],
            sources: ["src/second.tsx"],
            version: 3,
          },
          offset: { column: 0, line: 10 },
        },
      ],
    });

    expect(getSourceFromSourceMap(sourceMap, 1, 0)?.fileName).toBe("src/first.tsx");
    expect(getSourceFromSourceMap(sourceMap, 11, 0)?.fileName).toBe("src/second.tsx");
    expect(getSourceFromSourceMap(sourceMap, 11, 0)?.lineNumber).toBe(6);
  });

  it("keeps the full column for lines after the section offset line", () => {
    const sourceMap = createStandardSourceMap({
      sections: [
        {
          map: {
            mappings: [[[0, 0, 0, 0]], [[5, 0, 1, 3]]],
            sources: ["src/offset.tsx"],
            version: 3,
          },
          offset: { column: 7, line: 3 },
        },
      ],
    });

    const result = getSourceFromSourceMap(sourceMap, 5, 5);
    expect(result?.fileName).toBe("src/offset.tsx");
    expect(result?.lineNumber).toBe(2);
    expect(result?.columnNumber).toBe(3);
  });

  it("adjusts columns for frames on the section offset line", () => {
    const sourceMap = createStandardSourceMap({
      sections: [
        {
          map: {
            mappings: [[[0, 0, 0, 0]]],
            sources: ["src/first.tsx"],
            version: 3,
          },
          offset: { column: 100, line: 0 },
        },
      ],
    });

    expect(getSourceFromSourceMap(sourceMap, 1, 100)?.fileName).toBe("src/first.tsx");
    expect(getSourceFromSourceMap(sourceMap, 1, 50)).toBeNull();
  });

  it("returns null when no section matches the position", () => {
    const sourceMap = createStandardSourceMap({
      sections: [
        {
          map: { mappings: [[[0, 0, 0, 0]]], sources: ["src/first.tsx"], version: 3 },
          offset: { column: 0, line: 50 },
        },
      ],
    });

    expect(getSourceFromSourceMap(sourceMap, 10, 0)).toBeNull();
  });
});

const STANDARD_RAW_MAP = JSON.stringify({
  version: 3,
  file: "bundle.js",
  sources: ["src/app.tsx"],
  sourcesContent: ["const value = 1;"],
  names: [],
  mappings: encode([[[0, 0, 0, 0]]]),
});

const INDEX_RAW_MAP = JSON.stringify({
  version: 3,
  sections: [
    {
      offset: { line: 0, column: 0 },
      map: {
        version: 3,
        sources: ["src/app.tsx", "src/app.tsx"],
        names: [],
        mappings: encode([[[0, 0, 0, 0]]]),
      },
    },
  ],
});

const createFetchFn = (
  responses: Record<string, Response | (() => Response)>,
): ((url: string) => Promise<Response>) => {
  return (url: string) => {
    const match = responses[url];
    if (!match) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(typeof match === "function" ? match() : match);
  };
};

describe("getSourceMapImpl", () => {
  it("returns null for non-fetchable urls", async () => {
    expect(await getSourceMapImpl("")).toBeNull();
    expect(await getSourceMapImpl("   ")).toBeNull();
    expect(await getSourceMapImpl("rsc://React/Server/file.js")).toBeNull();
    expect(await getSourceMapImpl("data:application/json;base64,abc")).toBeNull();
  });

  it("returns null when the bundle fetch is not ok", async () => {
    const fetchFn = createFetchFn({});
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("returns null when the bundle is empty", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response("", { status: 200 }),
    });
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("returns null when there is no sourceMappingURL", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response("const value = 1;", { status: 200 }),
    });
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("returns null for non-fetchable sourcemap urls", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=chrome-extension://map.js.map",
        { status: 200 },
      ),
    });
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("returns null when the sourcemap fetch is not ok", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=bundle.js.map",
        { status: 200 },
      ),
    });
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("returns null when the sourcemap is not valid json", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=bundle.js.map",
        { status: 200 },
      ),
      "http://localhost/bundle.js.map": new Response("not json", { status: 200 }),
    });
    expect(await getSourceMapImpl("http://localhost/bundle.js", fetchFn)).toBeNull();
  });

  it("resolves relative sourcemap urls against the bundle url", async () => {
    const requestedUrls: string[] = [];
    const fetchFn = (url: string): Promise<Response> => {
      requestedUrls.push(url);
      if (url === "http://localhost/assets/bundle.js") {
        return Promise.resolve(
          new Response("const value = 1;\n//# sourceMappingURL=bundle.js.map", { status: 200 }),
        );
      }
      return Promise.resolve(new Response(STANDARD_RAW_MAP, { status: 200 }));
    };

    const sourceMap = await getSourceMapImpl("http://localhost/assets/bundle.js", fetchFn);
    expect(requestedUrls[1]).toBe("http://localhost/assets/bundle.js.map");
    expect(sourceMap?.sources).toEqual(["src/app.tsx"]);
  });

  it("uses absolute sourcemap urls as-is", async () => {
    const requestedUrls: string[] = [];
    const fetchFn = (url: string): Promise<Response> => {
      requestedUrls.push(url);
      if (url === "http://localhost/bundle.js") {
        return Promise.resolve(
          new Response("const value = 1;\n//# sourceMappingURL=/maps/bundle.js.map", {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response(STANDARD_RAW_MAP, { status: 200 }));
    };

    await getSourceMapImpl("http://localhost/bundle.js", fetchFn);
    expect(requestedUrls[1]).toBe("/maps/bundle.js.map");
  });

  it("finds the sourceMappingURL in a block comment", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n/*# sourceMappingURL=http://localhost/bundle.js.map */",
        { status: 200 },
      ),
      "http://localhost/bundle.js.map": new Response(STANDARD_RAW_MAP, { status: 200 }),
    });
    const sourceMap = await getSourceMapImpl("http://localhost/bundle.js", fetchFn);
    expect(sourceMap?.sources).toEqual(["src/app.tsx"]);
  });

  it("finds the sourceMappingURL when trailing lines follow it", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=http://localhost/bundle.js.map\nconst tail = 2;",
        { status: 200 },
      ),
      "http://localhost/bundle.js.map": new Response(STANDARD_RAW_MAP, { status: 200 }),
    });
    const sourceMap = await getSourceMapImpl("http://localhost/bundle.js", fetchFn);
    expect(sourceMap?.sources).toEqual(["src/app.tsx"]);
  });

  it("decodes standard source maps", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=http://localhost/bundle.js.map",
        { status: 200 },
      ),
      "http://localhost/bundle.js.map": new Response(STANDARD_RAW_MAP, { status: 200 }),
    });
    const sourceMap = await getSourceMapImpl("http://localhost/bundle.js", fetchFn);
    expect(sourceMap?.mappings).toEqual([[[0, 0, 0, 0]]]);
    expect(sourceMap?.sections).toBeUndefined();
  });

  it("decodes index source maps and deduplicates sources", async () => {
    const fetchFn = createFetchFn({
      "http://localhost/bundle.js": new Response(
        "const value = 1;\n//# sourceMappingURL=http://localhost/bundle.js.map",
        { status: 200 },
      ),
      "http://localhost/bundle.js.map": new Response(INDEX_RAW_MAP, { status: 200 }),
    });
    const sourceMap = await getSourceMapImpl("http://localhost/bundle.js", fetchFn);
    expect(sourceMap?.sections).toHaveLength(1);
    expect(sourceMap?.sources).toEqual(["src/app.tsx"]);
  });
});

describe("getSourceMap caching", () => {
  it("bypasses the cache when useCache is false", async () => {
    const file = "http://localhost/uncached-bundle.js";
    sourceMapCache.delete(file);
    let fetchCount = 0;
    const fetchFn = (url: string): Promise<Response> => {
      if (!url.endsWith(".map")) fetchCount++;
      return Promise.resolve(
        url.endsWith(".map")
          ? new Response(STANDARD_RAW_MAP, { status: 200 })
          : new Response("const value = 1;\n//# sourceMappingURL=uncached-bundle.js.map", {
              status: 200,
            }),
      );
    };

    expect(await getSourceMap(file, false, fetchFn)).not.toBeNull();
    expect(await getSourceMap(file, false, fetchFn)).not.toBeNull();
    expect(fetchCount).toBe(2);
    expect(sourceMapCache.has(file)).toBe(false);
  });

  it("returns the cached map on subsequent calls", async () => {
    const file = "http://localhost/cached-bundle.js";
    sourceMapCache.delete(file);
    let fetchCount = 0;
    const fetchFn = (url: string): Promise<Response> => {
      if (!url.endsWith(".map")) fetchCount++;
      return Promise.resolve(
        url.endsWith(".map")
          ? new Response(STANDARD_RAW_MAP, { status: 200 })
          : new Response("const value = 1;\n//# sourceMappingURL=cached-bundle.js.map", {
              status: 200,
            }),
      );
    };

    const firstResult = await getSourceMap(file, true, fetchFn);
    const secondResult = await getSourceMap(file, true, fetchFn);
    expect(firstResult).toBe(secondResult);
    expect(fetchCount).toBe(1);
  });

  it("deduplicates concurrent requests for the same file", async () => {
    const file = "http://localhost/concurrent-bundle.js";
    sourceMapCache.delete(file);
    let fetchCount = 0;
    const fetchFn = (url: string): Promise<Response> => {
      if (!url.endsWith(".map")) fetchCount++;
      return Promise.resolve(
        url.endsWith(".map")
          ? new Response(STANDARD_RAW_MAP, { status: 200 })
          : new Response("const value = 1;\n//# sourceMappingURL=concurrent-bundle.js.map", {
              status: 200,
            }),
      );
    };

    const [firstResult, secondResult] = await Promise.all([
      getSourceMap(file, true, fetchFn),
      getSourceMap(file, true, fetchFn),
    ]);
    expect(firstResult).not.toBeNull();
    expect(secondResult).not.toBeNull();
    expect(fetchCount).toBe(1);
  });
});

describe("default arguments", () => {
  it("getSourceMap defaults to caching and the global fetch", async () => {
    expect(await getSourceMap("rsc://React/Server/never-fetched.js")).toBeNull();
  });

  it("symbolicateStack defaults to caching", async () => {
    const frames: StackFrame[] = [{ functionName: "App" }];
    expect(await symbolicateStack(frames)).toEqual(frames);
  });
});

describe("symbolicateStack", () => {
  const createBundleFetchFn = (bundleName: string): ((url: string) => Promise<Response>) => {
    return (url: string) =>
      Promise.resolve(
        url.endsWith(".map")
          ? new Response(STANDARD_RAW_MAP, { status: 200 })
          : new Response(`const value = 1;\n//# sourceMappingURL=${bundleName}.map`, {
              status: 200,
            }),
      );
  };

  it("passes through frames without a file name", async () => {
    const frames: StackFrame[] = [{ functionName: "App" }];
    const result = await symbolicateStack(frames, false);
    expect(result).toEqual(frames);
  });

  it("passes through frames when no sourcemap exists", async () => {
    const fetchFn = createFetchFn({});
    const frames: StackFrame[] = [
      { fileName: "http://localhost/missing.js", lineNumber: 1, columnNumber: 0 },
    ];
    const result = await symbolicateStack(frames, false, fetchFn);
    expect(result[0].isSymbolicated).toBeUndefined();
  });

  it("passes through frames without line or column numbers", async () => {
    const fetchFn = createBundleFetchFn("frameless-bundle.js");
    const frames: StackFrame[] = [{ fileName: "http://localhost/frameless-bundle.js" }];
    const result = await symbolicateStack(frames, false, fetchFn);
    expect(result[0].isSymbolicated).toBeUndefined();
  });

  it("passes through frames when the sourcemap has no matching position", async () => {
    const fetchFn = createBundleFetchFn("nomatch-bundle.js");
    const frames: StackFrame[] = [
      { fileName: "http://localhost/nomatch-bundle.js", lineNumber: 99, columnNumber: 0 },
    ];
    const result = await symbolicateStack(frames, false, fetchFn);
    expect(result[0].isSymbolicated).toBeUndefined();
  });

  it("rewrites the frame and source string on success", async () => {
    const fetchFn = createBundleFetchFn("success-bundle.js");
    const frames: StackFrame[] = [
      {
        fileName: "http://localhost/success-bundle.js",
        lineNumber: 1,
        columnNumber: 0,
        source: "    at App (http://localhost/success-bundle.js:1:0)",
      },
    ];
    const result = await symbolicateStack(frames, false, fetchFn);
    expect(result[0].isSymbolicated).toBe(true);
    expect(result[0].fileName).toBe("src/app.tsx");
    expect(result[0].lineNumber).toBe(1);
    expect(result[0].source).toBe("    at App (src/app.tsx:1:0)");
  });

  it("keeps an undefined source when the frame has none", async () => {
    const fetchFn = createBundleFetchFn("sourceless-bundle.js");
    const frames: StackFrame[] = [
      { fileName: "http://localhost/sourceless-bundle.js", lineNumber: 1, columnNumber: 0 },
    ];
    const result = await symbolicateStack(frames, false, fetchFn);
    expect(result[0].isSymbolicated).toBe(true);
    expect(result[0].source).toBeUndefined();
  });
});
