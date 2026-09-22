import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import {
  getRawSource,
  getSource,
  hasDebugSource,
  isSourceFile,
  normalizeFileName,
} from "../../../bippy/src/source/get-source.js";

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

const createDebugStackFiber = (stackLines: string[]): Fiber => {
  const fiber = createFiberWithDebugSource(undefined);
  fiber._debugStack = createDebugStackError(stackLines);
  return fiber;
};

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
    expect(getRawSource(fiber)).toBe(debugSource);
  });

  it("returns a synchronous source from a trusted debug stack", () => {
    const fiber = createDebugStackFiber([
      "Error: react-stack-top-frame",
      "    at jsxDEV (http://localhost/react-jsx-dev-runtime.js:1:1)",
      "    at App (http://localhost/src/app.tsx:12:4)",
      "    at react-stack-bottom-frame (http://localhost/react.js:1:1)",
    ]);
    expect(getRawSource(fiber)).toEqual({
      columnNumber: 4,
      fileName: "http://localhost/src/app.tsx",
      functionName: "App",
      lineNumber: 12,
    });
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

  it("strips the turbopack:// prefix and the project root token", () => {
    expect(normalizeFileName("turbopack://[project]/src/app.tsx")).toBe("./src/app.tsx");
    expect(normalizeFileName("turbopack:///[project]/src/app.tsx")).toBe("/src/app.tsx");
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

  it("unwraps Vite /@fs/ urls into filesystem paths", () => {
    expect(normalizeFileName("https://example.local:5173/@fs/Users/me/proj/src/app.tsx")).toBe(
      "/Users/me/proj/src/app.tsx",
    );
    expect(normalizeFileName("http://localhost:5173/@fs/C:/proj/src/App.tsx")).toBe(
      "C:/proj/src/App.tsx",
    );
    expect(isSourceFile("http://localhost:5173/@fs/Users/me/proj/src/app.tsx")).toBe(true);
    expect(
      isSourceFile("http://localhost:5173/@fs/Users/me/proj/node_modules/react/index.js"),
    ).toBe(false);
  });

  it("drops Vite virtual module ids", () => {
    expect(normalizeFileName("http://localhost:5173/@id/__x00__virtual:helper")).toBe("");
    expect(isSourceFile("http://localhost:5173/@id/__x00__plugin-vue:export-helper")).toBe(false);
  });

  it("turns Windows file urls into drive paths", () => {
    expect(normalizeFileName("file:///C:/projects/app/src/app.tsx")).toBe(
      "C:/projects/app/src/app.tsx",
    );
    expect(normalizeFileName("file://localhost/Users/me/src/app.tsx")).toBe(
      "/Users/me/src/app.tsx",
    );
  });

  it("decodes escaped path segments without decoding separators", () => {
    expect(normalizeFileName("http://localhost:5173/src/my%20file.tsx")).toBe("/src/my file.tsx");
    expect(normalizeFileName("/src/my%2Ffile.tsx")).toBe("/src/my%2Ffile.tsx");
  });

  it("preserves network file hosts and share roots", () => {
    expect(normalizeFileName("file://server/share/src/../App.tsx")).toBe("//server/share/App.tsx");
    expect(normalizeFileName("rsc://file://server/share/../../App.tsx")).toBe(
      "//server/share/App.tsx",
    );
  });

  it("preserves real folders named after the Turbopack project token", () => {
    expect(normalizeFileName("./src/[project]/page.tsx")).toBe("./src/[project]/page.tsx");
    expect(normalizeFileName("turbopack://[project]/app/[project]/page.tsx")).toBe(
      "./app/[project]/page.tsx",
    );
  });

  it("does not classify virtual scheme ids as source files", () => {
    expect(isSourceFile("virtual:helper.ts")).toBe(false);
    expect(isSourceFile("rsc://virtual:helper.ts")).toBe(false);
  });

  it("strips a hash fragment", () => {
    expect(normalizeFileName("src/app.tsx#L12")).toBe("src/app.tsx");
  });

  it("collapses dot segments and keeps a leading dot-slash", () => {
    expect(normalizeFileName("./src/../lib/button.tsx")).toBe("./lib/button.tsx");
    expect(normalizeFileName("/src/../lib/button.tsx")).toBe("/lib/button.tsx");
  });

  it("strips Next.js bundler layers without eating route groups", () => {
    expect(normalizeFileName("webpack-internal:///(rsc)/./app/(marketing)/about/page.tsx")).toBe(
      "./app/(marketing)/about/page.tsx",
    );
    expect(normalizeFileName("webpack-internal:///(ssr)/./src/app.tsx")).toBe("./src/app.tsx");
    expect(normalizeFileName("webpack://_N_E/./src/hello.tsx")).toBe("./src/hello.tsx");
    expect(normalizeFileName("webpack://my-app/./src/file.tsx")).toBe("./src/file.tsx");
    expect(normalizeFileName("middleware/index.ts")).toBe("middleware/index.ts");
  });

  it("strips turbopack module metadata without eating route groups", () => {
    expect(normalizeFileName("[project]/src/app/page.tsx [app-rsc] (ecmascript)")).toBe(
      "./src/app/page.tsx",
    );
    expect(
      normalizeFileName(
        "[project]/examples/(group)/with-turbopack/app/foo.ts [app-rsc] (ecmascript)",
      ),
    ).toBe("./examples/(group)/with-turbopack/app/foo.ts");
    expect(normalizeFileName("./app/(marketing)/page.tsx (ecmascript)")).toBe(
      "./app/(marketing)/page.tsx",
    );
    expect(normalizeFileName("./src/app.tsx <locals>")).toBe("./src/app.tsx");
    expect(normalizeFileName("page.tsx [draft]")).toBe("page.tsx [draft]");
    expect(normalizeFileName("[root-of-the-server]__51ab98c8._.js")).toBe(
      "[root-of-the-server]__51ab98c8._.js",
    );
    expect(isSourceFile("[project]/src/app/page.tsx [app-rsc] (ecmascript)")).toBe(true);
    expect(isSourceFile("[root-of-the-server]__51ab98c8._.js")).toBe(false);
  });

  it("decodes turbopack magic identifiers into module paths", () => {
    expect(normalizeFileName("__TURBOPACK__module__evaluation__")).toBe("module evaluation");
    expect(normalizeFileName("__TURBOPACK__Hello$2f$World__")).toBe("Hello/World");
    expect(normalizeFileName("__TURBOPACK__Hello$_1f600$World__")).toBe("Hello😀World");
    expect(
      normalizeFileName(
        "__TURBOPACK__imported__module__$5b$project$5d2f$examples$2f$with$2d$turbopack$2f$app$2f$foo$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__",
      ),
    ).toBe("./examples/with-turbopack/app/foo.ts");
    expect(
      isSourceFile(
        "__TURBOPACK__imported__module__$5b$project$5d2f$examples$2f$with$2d$turbopack$2f$app$2f$foo$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__",
      ),
    ).toBe(true);
  });

  it("unwraps react server file urls for display", () => {
    expect(normalizeFileName("rsc://React/Server/file:///proj/server-chunk.js")).toBe(
      "/proj/server-chunk.js",
    );
    expect(normalizeFileName("about://React/Server/file:///proj/server-chunk.js?42")).toBe(
      "/proj/server-chunk.js",
    );
    expect(normalizeFileName("React/Server/src/app.tsx")).toBe("React/Server/src/app.tsx");
  });

  it("keeps the resource after a webpack loader chain", () => {
    expect(normalizeFileName("./node_modules/css-loader/dist/cjs.js!./app/page.tsx")).toBe(
      "./app/page.tsx",
    );
    expect(normalizeFileName("./node_modules/loader.js!./app/(marketing)/page.tsx?t=1")).toBe(
      "./app/(marketing)/page.tsx",
    );
    expect(normalizeFileName("button!.tsx")).toBe("button!.tsx");
  });

  it("normalizes parcel, rspack, and bun specifiers", () => {
    expect(normalizeFileName("parcel:///src/App.tsx")).toBe("/src/App.tsx");
    expect(normalizeFileName("parcel://src/App.tsx")).toBe("src/App.tsx");
    expect(normalizeFileName("rspack://my-app/./src/file.tsx")).toBe("./src/file.tsx");
    expect(normalizeFileName("rspack-internal:///(ssr)/./src/app.tsx")).toBe("./src/app.tsx");
    expect(normalizeFileName("bun:sqlite")).toBe("sqlite");
  });

  it("drops virtual module ids", () => {
    expect(normalizeFileName("\0virtual:helper")).toBe("");
    expect(normalizeFileName("virtual:react-router/server-build")).toBe("");
    expect(normalizeFileName("astro:scripts/before-hydration.js")).toBe("");
    expect(normalizeFileName("nitro:routes")).toBe("");
    expect(normalizeFileName("cloudflare:workers")).toBe("");
    expect(isSourceFile("virtual:react-router/server-build")).toBe(false);
    expect(isSourceFile("astro:scripts/before-hydration.js")).toBe(false);
  });

  it("strips a windows extended path prefix", () => {
    expect(normalizeFileName("\\\\?\\C:\\projects\\app\\src\\app.tsx")).toBe(
      "C:\\projects\\app\\src\\app.tsx",
    );
  });

  it("strips metro platform queries", () => {
    expect(normalizeFileName("/src/App.tsx?platform=ios&dev=true")).toBe("/src/App.tsx");
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
    expect(isSourceFile("/_next/static/chunks/main.js")).toBe(false);
    expect(isSourceFile("/@vite/client")).toBe(false);
    expect(isSourceFile("/src/.vite/deps/react.js")).toBe(false);
    expect(isSourceFile("/.parcel-cache/file.js")).toBe(false);
    expect(isSourceFile("/app/.expo/file.js")).toBe(false);
    expect(isSourceFile("/.rsbuild/server/index.js")).toBe(false);
    expect(isSourceFile("/.svelte-kit/output/server/index.js")).toBe(false);
    expect(isSourceFile("/.astro/file.js")).toBe(false);
    expect(isSourceFile("/_nuxt/entry.js")).toBe(false);
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
