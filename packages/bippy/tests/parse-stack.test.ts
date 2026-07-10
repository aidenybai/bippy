import { describe, expect, it } from "vitest";
import {
  extractLocation,
  parseFFOrSafariString,
  parseStack,
  parseV8OrIeString,
} from "../src/source/parse-stack.js";

const CHROME_STACK = [
  "Error: boom",
  "    at renderApp (http://localhost:3000/static/app.js:10:15)",
  "    at http://localhost:3000/static/app.js:20:5",
  "    at eval (eval at evaluate (http://localhost:3000/static/app.js:30:1), <anonymous>:1:1)",
  "    at new Widget (http://localhost:3000/static/widget.js:40:9)",
].join("\n");

const FIREFOX_STACK = [
  "renderApp@http://localhost:3000/static/app.js:10:15",
  "@http://localhost:3000/static/app.js:20:5",
  "evalFrame@http://localhost:3000/static/app.js line 30 > eval:1:1",
  "trace@[native code]",
].join("\n");

describe("parseStack (default includeInElement mode)", () => {
  it("parses chrome-style 'at' lines", () => {
    const frames = parseStack(CHROME_STACK);
    expect(frames[0].functionName).toBe("renderApp");
    expect(frames[0].fileName).toBe("http://localhost:3000/static/app.js");
    expect(frames[0].lineNumber).toBe(10);
    expect(frames[0].columnNumber).toBe(15);
  });

  it("parses 'in Component' element frames and strips '(at ...)' suffixes", () => {
    const frames = parseStack("    in TodoItem (at Server)\n    in App");
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe("TodoItem");
    expect(frames[0].source).toBe("    in TodoItem (at Server)");
    expect(frames[1].functionName).toBe("App");
  });

  it("parses firefox-style frames mixed into the stack", () => {
    const frames = parseStack("renderApp@http://localhost:3000/static/app.js:10:15");
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("renderApp");
    expect(frames[0].fileName).toBe("http://localhost:3000/static/app.js");
    expect(frames[0].lineNumber).toBe(10);
  });

  it("skips lines that match no known format", () => {
    const frames = parseStack("Error: boom\nsomething unrelated");
    expect(frames).toHaveLength(0);
  });

  it("applies a numeric slice", () => {
    const frames = parseStack(CHROME_STACK, { slice: 2 });
    expect(frames).toHaveLength(2);
  });

  it("applies a tuple slice", () => {
    const frames = parseStack(CHROME_STACK, { slice: [1, 3] });
    expect(frames).toHaveLength(2);
    expect(frames[0].fileName).toBe("http://localhost:3000/static/app.js");
  });
});

describe("parseStack (includeInElement: false)", () => {
  it("routes chrome stacks to the v8 parser", () => {
    const frames = parseStack(CHROME_STACK, { includeInElement: false });
    expect(frames[0].functionName).toBe("renderApp");
    expect(frames).toHaveLength(4);
  });

  it("routes firefox stacks to the firefox/safari parser", () => {
    const frames = parseStack(FIREFOX_STACK, { includeInElement: false });
    expect(frames[0].functionName).toBe("renderApp");
  });
});

describe("parseV8OrIeString", () => {
  it("parses anonymous frames without function names", () => {
    const frames = parseV8OrIeString(CHROME_STACK);
    expect(frames[1].functionName).toBeUndefined();
    expect(frames[1].fileName).toBe("http://localhost:3000/static/app.js");
    expect(frames[1].lineNumber).toBe(20);
    expect(frames[1].columnNumber).toBe(5);
  });

  it("normalizes eval frames to the outer call site", () => {
    const frames = parseV8OrIeString(CHROME_STACK);
    expect(frames[2].fileName).toBe("http://localhost:3000/static/app.js");
    expect(frames[2].lineNumber).toBe(30);
  });

  it("drops <anonymous> and eval file names", () => {
    const frames = parseV8OrIeString("    at foo (<anonymous>:1:2)\n    at bar (eval:3:4)");
    expect(frames[0].fileName).toBeUndefined();
    expect(frames[0].lineNumber).toBe(1);
    expect(frames[1].fileName).toBeUndefined();
    expect(frames[1].lineNumber).toBe(3);
  });

  it("keeps constructor frames with 'new' prefixes", () => {
    const frames = parseV8OrIeString(CHROME_STACK);
    expect(frames[3].fileName).toBe("http://localhost:3000/static/widget.js");
    expect(frames[3].lineNumber).toBe(40);
  });

  it("handles 'eval code' frames from IE", () => {
    const frames = parseV8OrIeString("    at eval code (eval code:1:1)");
    expect(frames).toHaveLength(1);
    expect(frames[0].lineNumber).toBe(1);
  });

  it("handles native frames without line numbers", () => {
    const frames = parseV8OrIeString("    at Array.forEach (native)");
    expect(frames).toHaveLength(1);
    expect(frames[0].lineNumber).toBeUndefined();
  });
});

describe("parseFFOrSafariString", () => {
  it("parses standard firefox frames", () => {
    const frames = parseFFOrSafariString(FIREFOX_STACK);
    expect(frames[0].functionName).toBe("renderApp");
    expect(frames[0].fileName).toBe("http://localhost:3000/static/app.js");
    expect(frames[0].lineNumber).toBe(10);
    expect(frames[0].columnNumber).toBe(15);
  });

  it("collapses firefox eval frames onto the original line", () => {
    const frames = parseFFOrSafariString(FIREFOX_STACK);
    const evalFrame = frames.find((frame) => frame.functionName === "evalFrame");
    expect(evalFrame?.lineNumber).toBe(30);
  });

  it("filters safari native code frames", () => {
    const frames = parseFFOrSafariString("[native code]\neval@[native code]\nfn@file.js:1:2");
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("fn");
  });

  it("returns only a function name for bare safari frames", () => {
    const frames = parseFFOrSafariString("globalCode");
    expect(frames).toEqual([{ functionName: "globalCode" }]);
  });

  it("parses frames without a function name", () => {
    const frames = parseFFOrSafariString("@http://localhost:3000/static/app.js:20:5");
    expect(frames[0].functionName).toBeUndefined();
    expect(frames[0].fileName).toBe("http://localhost:3000/static/app.js");
  });
});

describe("extractLocation", () => {
  it("returns the input untouched when there is no colon", () => {
    expect(extractLocation("native")).toEqual(["native", undefined, undefined]);
  });

  it("parses a location with only a line number", () => {
    expect(extractLocation("file.js:10")).toEqual(["file.js", "10", undefined]);
  });

  it("returns no line number for a trailing colon", () => {
    expect(extractLocation("file.js:")).toEqual(["file.js:", undefined, undefined]);
  });
});

describe("parseStack malformed frames", () => {
  it("drops 'at' lines without a resolvable location", () => {
    const frames = parseStack("    at mystery\n    at real (file.js:1:2)");
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("real");
  });
});
