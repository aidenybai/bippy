import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "../src/react-internals/index.js";
import {
  getSource,
  hasDebugSource,
  isSourceFile,
  normalizeFileName,
} from "../src/source/get-source.js";

const createFiberWithDebugSource = (debugSource: unknown): Fiber =>
  ({
    tag: 999,
    type: null,
    return: null,
    child: null,
    sibling: null,
    _debugSource: debugSource,
  }) as unknown as Fiber;

const createDebugStackError = (stackLines: string[]): Error => {
  const error = new Error("react-stack-top-frame");
  error.stack = stackLines.join("\n");
  return error;
};

const createDebugStackFiber = (stackLines: string[]): Fiber =>
  ({
    tag: 999,
    type: null,
    return: null,
    child: null,
    sibling: null,
    _debugStack: createDebugStackError(stackLines),
  }) as unknown as Fiber;

describe("hasDebugSource", () => {
  it("returns true for a well-formed debug source", () => {
    const fiber = createFiberWithDebugSource({ fileName: "App.tsx", lineNumber: 10 });
    expect(hasDebugSource(fiber)).toBe(true);
  });

  it("returns false when the debug source is missing", () => {
    expect(hasDebugSource(createFiberWithDebugSource(undefined))).toBe(false);
    expect(hasDebugSource(createFiberWithDebugSource(null))).toBe(false);
  });

  it("returns false when fileName is missing or not a string", () => {
    expect(hasDebugSource(createFiberWithDebugSource({ lineNumber: 10 }))).toBe(false);
    expect(hasDebugSource(createFiberWithDebugSource({ fileName: 42, lineNumber: 10 }))).toBe(
      false,
    );
  });

  it("returns false for a native pseudo-file", () => {
    expect(
      hasDebugSource(createFiberWithDebugSource({ fileName: "(native)", lineNumber: 10 })),
    ).toBe(false);
  });

  it("returns false when lineNumber is missing or not a number", () => {
    expect(hasDebugSource(createFiberWithDebugSource({ fileName: "App.tsx" }))).toBe(false);
    expect(
      hasDebugSource(createFiberWithDebugSource({ fileName: "App.tsx", lineNumber: "10" })),
    ).toBe(false);
  });
});

describe("getSource with _debugSource", () => {
  it("returns the debug source directly without an owner stack", async () => {
    const debugSource = { fileName: "App.tsx", lineNumber: 10, columnNumber: 5 };
    const fiber = createFiberWithDebugSource(debugSource);
    const result = await getSource(fiber);
    expect(result).toBe(debugSource);
  });
});

describe("getSource with native debug frames", () => {
  it("skips a native debug source in favor of a source stack frame", async () => {
    const fiber = createDebugStackFiber([
      "Error: react-stack-top-frame",
      "    at jsxDEV (native)",
      "    at renderLeaf (http://localhost/src/skia-probe.tsx:12:4)",
      "    at react-stack-bottom-frame (http://localhost/react.js:1:1)",
    ]);
    fiber._debugSource = {
      fileName: "(native)",
      lineNumber: 1,
      columnNumber: 1,
    };

    const source = await getSource(fiber, false, () =>
      Promise.resolve(new Response("not found", { status: 404 })),
    );

    expect(source).toEqual({
      columnNumber: 4,
      fileName: "http://localhost/src/skia-probe.tsx",
      functionName: "renderLeaf",
      lineNumber: 12,
    });
  });

  it("skips native pseudo-frames in favor of a source frame", async () => {
    const fiber = createDebugStackFiber([
      "Error: react-stack-top-frame",
      "    at jsxDEV (native)",
      "    at SkiaLeaf (native)",
      "    at renderLeaf (http://localhost/src/skia-probe.tsx:12:4)",
      "    at react-stack-bottom-frame (http://localhost/react.js:1:1)",
    ]);

    const source = await getSource(fiber, false, () =>
      Promise.resolve(new Response("not found", { status: 404 })),
    );

    expect(source).toEqual({
      columnNumber: 4,
      fileName: "http://localhost/src/skia-probe.tsx",
      functionName: "renderLeaf",
      lineNumber: 12,
    });
  });

  it("uses an owned child's source frame when the fiber stack is native-only", async () => {
    const parentFiber = createDebugStackFiber([
      "Error: react-stack-top-frame",
      "    at jsxDEV (native)",
      "    at SkiaLeaf (native)",
      "    at react-stack-bottom-frame (http://localhost/react.js:1:1)",
    ]);
    const childFiber = createDebugStackFiber([
      "Error: react-stack-top-frame",
      "    at jsxDEV (native)",
      "    at SkiaHost (native)",
      "    at SkiaLeaf (http://localhost/src/skia-probe.tsx:20:6)",
      "    at react-stack-bottom-frame (http://localhost/react.js:1:1)",
    ]);
    parentFiber.child = childFiber;
    childFiber.return = parentFiber;
    childFiber._debugOwner = parentFiber;

    const source = await getSource(parentFiber, false, () =>
      Promise.resolve(new Response("not found", { status: 404 })),
    );

    expect(source).toEqual({
      columnNumber: 6,
      fileName: "http://localhost/src/skia-probe.tsx",
      functionName: "SkiaLeaf",
      lineNumber: 20,
    });
  });
});

describe("normalizeFileName", () => {
  it("returns an empty string for empty input", () => {
    expect(normalizeFileName("")).toBe("");
  });

  it("returns an empty string for anonymous file patterns", () => {
    expect(normalizeFileName("<anonymous>")).toBe("");
    expect(normalizeFileName("eval")).toBe("");
  });

  it("reduces unparsable http urls to an empty string", () => {
    expect(normalizeFileName("http://")).toBe("");
  });

  it("strips the about://React/ prefix with a path", () => {
    expect(normalizeFileName("about://React/Server/src/app.tsx")).toBe("src/app.tsx");
  });

  it("keeps the full remainder when about://React/ has a colon before the slash", () => {
    expect(normalizeFileName("about://React/Server:1/app")).toBe("1/app");
  });

  it("keeps the remainder when about://React/ has no slash", () => {
    expect(normalizeFileName("about://React/Server")).toBe("Server");
  });

  it("strips the file:/// prefix into an absolute path", () => {
    expect(normalizeFileName("file:///Users/me/project/src/app.tsx")).toBe(
      "/Users/me/project/src/app.tsx",
    );
  });

  it("collapses duplicate slashes after file:///", () => {
    expect(normalizeFileName("file:////Users/me/src/app.tsx")).toBe("/Users/me/src/app.tsx");
  });

  it("strips stacked internal prefixes", () => {
    expect(normalizeFileName("rsc://file:///Users/me/src/app.tsx")).toBe("/Users/me/src/app.tsx");
  });

  it("strips the turbopack:// prefix", () => {
    expect(normalizeFileName("turbopack://[project]/src/app.tsx")).toBe("[project]/src/app.tsx");
  });

  it("strips the node: prefix", () => {
    expect(normalizeFileName("node:internal/modules/cjs/loader")).toBe(
      "internal/modules/cjs/loader",
    );
  });

  it("strips unknown schemes", () => {
    expect(normalizeFileName("custom-scheme:src/app.tsx")).toBe("src/app.tsx");
  });

  it("preserves Windows drive paths", () => {
    expect(normalizeFileName("C:\\projects\\app\\src\\app.tsx")).toBe(
      "C:\\projects\\app\\src\\app.tsx",
    );
  });

  it("strips a protocol-relative host prefix", () => {
    expect(normalizeFileName("webpack:////host/src/app.tsx")).toBe("/src/app.tsx");
  });

  it("returns an empty string for a protocol-relative host without a path", () => {
    expect(normalizeFileName("webpack:////hostonly")).toBe("");
  });

  it("keeps query-like suffixes that are not query parameters", () => {
    expect(normalizeFileName("src/app.tsx?not a query!")).toBe("src/app.tsx?not a query!");
  });

  it("strips query parameters with multiple entries", () => {
    expect(normalizeFileName("src/app.tsx?t=123&v=4")).toBe("src/app.tsx");
  });
});

describe("isSourceFile", () => {
  it("returns false for file names that normalize to empty", () => {
    expect(isSourceFile("<anonymous>")).toBe(false);
  });

  it("returns false for non-source extensions", () => {
    expect(isSourceFile("/src/styles.css")).toBe(false);
  });

  it("returns false for bundled files", () => {
    expect(isSourceFile("/dist/app.js")).toBe(false);
    expect(isSourceFile("/static/chunk-abc123.js")).toBe(false);
    expect(isSourceFile("/node_modules/react/index.js")).toBe(false);
  });

  it("returns true for plain source files", () => {
    expect(isSourceFile("/src/components/button.tsx")).toBe(true);
    expect(isSourceFile("/src/app.ts")).toBe(true);
    expect(isSourceFile("/src/content.mdx")).toBe(true);
    expect(isSourceFile("/src/server.mts")).toBe(true);
    expect(isSourceFile("/src/config.cjs")).toBe(true);
  });
});

describe("normalizeFileName base path stripping", () => {
  it("treats a double-slash pathname as protocol-relative", () => {
    expect(normalizeFileName("http://localhost//src/app.tsx")).toBe("/app.tsx");
  });

  it("keeps single-file paths after the base path", () => {
    expect(normalizeFileName("http://localhost/base/app.tsx")).toBe("/base/app.tsx");
  });

  it("keeps paths whose first remainder segment is longer than four characters", () => {
    expect(normalizeFileName("http://localhost/base/longer/app.tsx")).toBe("/base/longer/app.tsx");
  });

  it("keeps paths whose first remainder segment is scoped", () => {
    expect(normalizeFileName("http://localhost/base/@app/entry.tsx")).toBe("/base/@app/entry.tsx");
  });
});
