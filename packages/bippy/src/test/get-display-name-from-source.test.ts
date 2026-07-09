import { encode } from "@jridgewell/sourcemap-codec";
import { describe, expect, it } from "vitest";
import type { Fiber } from "../types.js";
import { getDisplayNameFromSource } from "../source/get-display-name-from-source.js";

const FUNCTION_COMPONENT_TAG = 0;
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
  sourceLines?: string[];
  sourcesContent?: string[];
  mappedLineCount?: number;
}

const createFixedPointRawMap = (targetLine: number, options: FixedPointMapOptions): string => {
  const mappedLineCount = options.mappedLineCount ?? TOTAL_MAPPED_LINES;
  const sourcesContent = options.sourceLines
    ? [options.sourceLines.join("\n")]
    : options.sourcesContent;
  return JSON.stringify({
    version: 3,
    sources: ["src/app.tsx"],
    ...(sourcesContent ? { sourcesContent } : {}),
    names: [],
    mappings: encode(Array.from({ length: mappedLineCount }, () => [[0, 0, targetLine - 1, 0]])),
  });
};

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
      FUNCTION_COMPONENT_TAG,
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
      FUNCTION_COMPONENT_TAG,
      createThrowingComponent("UnmappedComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("UnmappedComponent");
  });

  it("falls back when the source map has no sources content", async () => {
    const rawMap = createFixedPointRawMap(1, {});
    const fiber = createFakeFiber(
      FUNCTION_COMPONENT_TAG,
      createThrowingComponent("NoContentComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("NoContentComponent");
  });

  it("falls back when the sources content entry is empty", async () => {
    const rawMap = createFixedPointRawMap(1, { sourcesContent: [""] });
    const fiber = createFakeFiber(
      FUNCTION_COMPONENT_TAG,
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
      FUNCTION_COMPONENT_TAG,
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
    const fiber = createFakeFiber(FUNCTION_COMPONENT_TAG, createThrowingComponent("MinifiedArrow"));
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("FancyButton");
  });

  it("extracts function declaration component names", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["function OrderList() {", "  return null;", "}"],
    });
    const fiber = createFakeFiber(
      FUNCTION_COMPONENT_TAG,
      createThrowingComponent("MinifiedFunction"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("OrderList");
  });

  it("extracts class component names", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["export class ProfileCard {", "  render() { return null; }", "}"],
    });
    const fiber = createFakeFiber(FUNCTION_COMPONENT_TAG, createThrowingComponent("MinifiedClass"));
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("ProfileCard");
  });

  it("falls back when no declaration pattern matches the source content", async () => {
    const rawMap = createFixedPointRawMap(1, {
      sourceLines: ["// nothing declarative here", "42;"],
    });
    const fiber = createFakeFiber(
      FUNCTION_COMPONENT_TAG,
      createThrowingComponent("NoPatternComponent"),
    );
    const result = await getDisplayNameFromSource(fiber, false, createSourceMapFetchFn(rawMap));
    expect(result).toBe("NoPatternComponent");
  });
});
