import { encode } from "@jridgewell/sourcemap-codec";
import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "../src/react-internals/index.js";
import { getDisplayNameFromSource } from "../src/source/get-display-name-from-source.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const UNKNOWN_TAG = 999;
// HACK: mappings cover every plausible generated line so the real (instrumented)
// stack line of the throwing component always resolves to the same source line
const TOTAL_MAPPED_LINES = 20000;

const createThrowingComponent = (componentName: string): (() => null) => {
  const component = (): null => {
    throw new Error("intentional inspection error");
  };
  Object.defineProperty(component, "name", { value: componentName });
  return component;
};

const createFakeFiber = (tag: number, type: unknown): Fiber =>
  ({
    tag,
    type,
    return: null,
    child: null,
    sibling: null,
  }) as unknown as Fiber;

interface FixedPointMapOptions {
  mappedName?: string;
  sourceLines?: string[];
  sourcesContent?: string[];
  mappedLineCount?: number;
}

const createFixedPointRawMap = (targetLine: number, options: FixedPointMapOptions): string => {
  const mappedLineCount = options.mappedLineCount ?? TOTAL_MAPPED_LINES;
  const sourcesContent = options.sourceLines
    ? [options.sourceLines.join("\n")]
    : options.sourcesContent;
  const mapping = options.mappedName ? [0, 0, targetLine - 1, 0, 0] : [0, 0, targetLine - 1, 0];
  return JSON.stringify({
    version: 3,
    sources: ["src/app.tsx"],
    ...(sourcesContent ? { sourcesContent } : {}),
    names: options.mappedName ? [options.mappedName] : [],
    mappings: encode(Array.from({ length: mappedLineCount }, () => [mapping])),
  });
};

const createIndexedFixedPointRawMap = (targetLine: number, sourceContent: string): string =>
  JSON.stringify({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: ["src/indexed-app.tsx"],
          sourcesContent: [sourceContent],
          names: [],
          mappings: encode(
            Array.from({ length: TOTAL_MAPPED_LINES }, () => [[0, 0, targetLine - 1, 0]]),
          ),
        },
      },
    ],
  });

const createSourceMapFetchFn = (rawMap: string): ((url: string) => Promise<Response>) => {
  return (url: string) =>
    Promise.resolve(
      url.endsWith(".map")
        ? new Response(rawMap, { status: 200 })
        : new Response("const bundled = 1;\n//# sourceMappingURL=bundle.js.map", {
            status: 200,
          }),
    );
};

const failingFetchFn = (): Promise<Response> =>
  Promise.resolve(new Response("not found", { status: 404 }));

describe("getDisplayNameFromSource", () => {
  it("falls back to the fiber display name when no frame has a file name", async () => {
    const fiber = createFakeFiber(UNKNOWN_TAG, createThrowingComponent("PlainComponent"));
    const result = await getDisplayNameFromSource(fiber, false, failingFetchFn);
    expect(result).toBe("PlainComponent");
  });

  it("uses default caching arguments when only the fiber is provided", async () => {
    const fiber = createFakeFiber(UNKNOWN_TAG, createThrowingComponent("DefaultArgsComponent"));
    const result = await getDisplayNameFromSource(fiber);
    expect(result).toBe("DefaultArgsComponent");
  });

  it("falls back when no source map can be fetched", async () => {
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("NoMapComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, failingFetchFn);
    expect(result).toBe("NoMapComponent");
  });

  it("falls back when the source map has no matching position", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["const Ignored = () => null;"],
      mappedLineCount: 1,
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("UnmappedComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("UnmappedComponent");
  });

  it("falls back when the source map has no sources content", async () => {
    const rawMap = createFixedPointRawMap(1, {});
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("NoContentComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("NoContentComponent");
  });

  it("uses original source-map names when source content is unavailable", async () => {
    const rawMap = createFixedPointRawMap(1, { mappedName: "BookmarkSaveAction" });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("Ag"),
    );

    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));

    expect(result).toBe("BookmarkSaveAction");
  });

  it("falls back when the sources content entry is empty", async () => {
    const rawMap = createFixedPointRawMap(1, { sourcesContent: [""] });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("EmptyContentComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("EmptyContentComponent");
  });

  it("falls back when the mapped line is outside the source content", async () => {
    const rawMap = createFixedPointRawMap(50, {
      sourceLines: ["const short = 1;", "const file = 2;"],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("OutOfBoundsComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("OutOfBoundsComponent");
  });

  it("extracts arrow function component names from the source content", async () => {
    const rawMap = createFixedPointRawMap(3, {
      sourceLines: [
        "import React from 'react';",
        "",
        "export const FancyButton = () => {",
        "  return null;",
        "};",
      ],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("MinifiedArrow"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("FancyButton");
  });

  it("extracts function declaration component names", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["function OrderList() {", "  return null;", "}"],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("MinifiedFunction"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("OrderList");
  });

  it("extracts class component names", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["export class ProfileCard {", "  render() { return null; }", "}"],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("MinifiedClass"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("ProfileCard");
  });

  it("extracts component names from indexed source-map section content", async () => {
    const rawMap = createIndexedFixedPointRawMap(
      1,
      "export const IndexedProfileCard = () => null;",
    );
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("IndexedMinified"),
    );

    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));

    expect(result).toBe("IndexedProfileCard");
  });

  it("falls back when no declaration pattern matches the source content", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["// nothing declarative here", "42;"],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("NoPatternComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("NoPatternComponent");
  });

  it("extracts the declaration closest to the mapped line when several are in range", async () => {
    const rawMap = createFixedPointRawMap(4, {
      sourceLines: [
        "const NeighborComponent = () => null;",
        "",
        "export class TargetComponent {",
        "  render() { return null; }",
        "}",
      ],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("MinifiedNested"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("TargetComponent");
  });

  it("prefers a declaration above the mapped line over one equally far below", async () => {
    const rawMap = createFixedPointRawMap(2, {
      sourceLines: [
        "export function EnclosingComponent() {",
        "  return null;",
        "const FollowingComponent = () => null;",
      ],
    });
    const fiber = createFakeFiber(
      latestReactWorkTags.FunctionComponent,
      createThrowingComponent("MinifiedEnclosed"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("EnclosingComponent");
  });
});
