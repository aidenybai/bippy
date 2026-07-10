import { describe, expect, it } from "vitest";
import { parseDebugStack } from "../src/source/parse-debug-stack.js";

// stands in for jsxDEV: the top frame of a _debugStack, dropped by the parser
const fakeJsxFactory = (): Error => new Error("react-stack-top-frame");

const react_stack_bottom_frame = (render: () => Error): Error => render();

describe("parseDebugStack", () => {
  it("skips the JSX factory frame and returns structured frames", () => {
    const usageSite = (): Error => fakeJsxFactory();
    const { frames } = parseDebugStack(usageSite());
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].functionName).toContain("usageSite");
    expect(frames[0].fileName).toContain("parse-debug-stack.test.ts");
    expect(typeof frames[0].lineNumber).toBe("number");
    expect(typeof frames[0].columnNumber).toBe("number");
  });

  it("carries enclosing line/column pointing at the function definition start", () => {
    const usageSite = (): Error => fakeJsxFactory();
    const { frames } = parseDebugStack(usageSite());
    expect(typeof frames[0].enclosingLineNumber).toBe("number");
    expect(frames[0].enclosingLineNumber).toBeLessThanOrEqual(frames[0].lineNumber ?? 0);
  });

  it("trusts stacks with the react bottom-frame sentinel and cuts at it", () => {
    const result = parseDebugStack(react_stack_bottom_frame(() => fakeJsxFactory()));
    expect(result.isTrusted).toBe(true);
    expect(
      result.frames.some((frame) => frame.functionName?.includes("react_stack_bottom_frame")),
    ).toBe(false);
  });

  it("marks stacks captured outside a react render as untrusted", () => {
    const result = parseDebugStack(fakeJsxFactory());
    expect(result.isTrusted).toBe(false);
    expect(result.frames.length).toBeGreaterThan(0);
  });

  it("caches the parse result per error", () => {
    const debugStack = fakeJsxFactory();
    expect(parseDebugStack(debugStack)).toBe(parseDebugStack(debugStack));
  });

  it("falls back to string parsing when the stack was already materialized", () => {
    const debugStack = react_stack_bottom_frame(() => fakeJsxFactory());
    void debugStack.stack;
    const result = parseDebugStack(debugStack);
    expect(result.isTrusted).toBe(true);
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.frames[0].fileName).toContain("parse-debug-stack.test.ts");
  });

  it("leaves error.stack readable in the default format after structured parsing", () => {
    const debugStack = fakeJsxFactory();
    parseDebugStack(debugStack);
    expect(String(debugStack.stack)).toContain("    at ");
  });
});
