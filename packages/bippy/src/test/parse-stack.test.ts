import { describe, expect, it } from "vitest";
import {
  extractLocation,
  parseFFOrSafari,
  parseFFOrSafariString,
  parseOpera,
  parseOpera9,
  parseOpera10,
  parseOpera11,
  parseStack,
  parseV8OrIE,
  parseV8OrIeString,
} from "../source/parse-stack.js";

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

describe("parseV8OrIE", () => {
  it("parses the stack of an Error object", () => {
    const error = new Error("boom");
    error.stack = CHROME_STACK;
    const frames = parseV8OrIE(error);
    expect(frames).toHaveLength(4);
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

describe("parseFFOrSafari", () => {
  it("parses the stack of an Error object", () => {
    const error = new Error("boom");
    error.stack = FIREFOX_STACK;
    const frames = parseFFOrSafari(error);
    expect(frames.length).toBeGreaterThan(0);
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

const OPERA9_MESSAGE = [
  "Statement on line 44: Type mismatch (usually non-object value supplied where object required)",
  "Backtrace:",
  "  Line 44 of linked script http://site.com/main.js",
  "    discarded()",
  "  Line 10 of inline#1 script in http://site.com/index.html",
  "    call()",
].join("\n");

const OPERA10_STACKTRACE = [
  "  Line 44 of linked script http://site.com/main.js: In function foo",
  "    discarded()",
  "  Line 10 of inline#1 script in http://site.com/index.html",
  "    call()",
].join("\n");

const OPERA11_STACK = [
  "Error thrown at line 42, column 12 in <anonymous function: createFault>(sig) in http://site.com/main.js:",
  "createException(sig)@http://site.com/main.js:42:12",
  "run([arguments not available])@http://site.com/main.js:52:8",
  "@http://site.com/index.html:11:9",
  "Error created at anonymous",
].join("\n");

interface OperaLikeError {
  message: string;
  stacktrace?: string;
  stack?: string;
}

const createOperaError = (overrides: OperaLikeError): Error => {
  const error = new Error(overrides.message);
  error.message = overrides.message;
  if ("stacktrace" in overrides) {
    Object.defineProperty(error, "stacktrace", { value: overrides.stacktrace });
  }
  Object.defineProperty(error, "stack", { value: overrides.stack, configurable: true });
  return error;
};

describe("parseOpera9", () => {
  it("parses frames from the error message", () => {
    const error = createOperaError({ message: OPERA9_MESSAGE });
    const frames = parseOpera9(error);
    expect(frames).toHaveLength(2);
    expect(frames[0].fileName).toBe("http://site.com/main.js");
    expect(frames[0].lineNumber).toBe(44);
    expect(frames[1].fileName).toBe("http://site.com/index.html");
  });

  it("skips message lines that do not describe frames", () => {
    const error = createOperaError({
      message: `${OPERA9_MESSAGE}\n  unrelated trailing text\n  more text`,
    });
    expect(parseOpera9(error)).toHaveLength(2);
  });
});

describe("parseOpera10", () => {
  it("parses frames from the nonstandard stacktrace property", () => {
    const error = createOperaError({ message: "boom", stacktrace: OPERA10_STACKTRACE });
    const frames = parseOpera10(error);
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe("foo");
    expect(frames[0].fileName).toBe("http://site.com/main.js");
    expect(frames[1].functionName).toBeUndefined();
  });

  it("returns no frames when stacktrace is missing", () => {
    const error = createOperaError({ message: "boom" });
    expect(parseOpera10(error)).toHaveLength(0);
  });
});

describe("parseOpera11", () => {
  it("parses frames with args and anonymous functions", () => {
    const error = createOperaError({ message: "boom", stack: OPERA11_STACK });
    const frames = parseOpera11(error);
    expect(frames).toHaveLength(3);
    expect(frames[0].functionName).toBe("createException");
    expect(frames[0].args).toEqual(["sig"]);
    expect(frames[1].functionName).toBe("run");
    expect(frames[1].args).toBeUndefined();
    expect(frames[2].functionName).toBeUndefined();
    expect(frames[2].fileName).toBe("http://site.com/index.html");
  });

  it("parses frames without a column number", () => {
    const error = createOperaError({
      message: "boom",
      stack: "shortFrame()@http://site.com/simple.js:42",
    });
    const frames = parseOpera11(error);
    expect(frames[0].lineNumber).toBe(42);
    expect(frames[0].columnNumber).toBeUndefined();
  });

  it("parses frames whose location token has no line number", () => {
    const error = createOperaError({ message: "boom", stack: "inner:1@plainfile" });
    const frames = parseOpera11(error);
    expect(frames[0].fileName).toBe("plainfile");
    expect(frames[0].lineNumber).toBeUndefined();
    expect(frames[0].columnNumber).toBeUndefined();
  });
});

describe("parseOpera", () => {
  it("uses opera 9 parsing when there is no stacktrace property", () => {
    const error = createOperaError({ message: OPERA9_MESSAGE });
    const frames = parseOpera(error);
    expect(frames).toHaveLength(2);
  });

  it("uses opera 9 parsing when the message has more lines than the stacktrace", () => {
    const error = createOperaError({
      message: OPERA9_MESSAGE,
      stacktrace: "  Line 44 of linked script http://site.com/main.js",
    });
    const frames = parseOpera(error);
    expect(frames[0].lineNumber).toBe(44);
  });

  it("uses opera 10 parsing when there is a stacktrace but no stack", () => {
    const error = createOperaError({
      message: "boom",
      stacktrace: OPERA10_STACKTRACE,
      stack: undefined,
    });
    const frames = parseOpera(error);
    expect(frames[0].functionName).toBe("foo");
  });

  it("uses opera 11 parsing when both stacktrace and stack exist", () => {
    const error = createOperaError({
      message: "boom",
      stacktrace: OPERA10_STACKTRACE,
      stack: OPERA11_STACK,
    });
    const frames = parseOpera(error);
    expect(frames[0].functionName).toBe("createException");
  });

  it("ignores non-string stacktrace properties", () => {
    const error = createOperaError({ message: OPERA9_MESSAGE });
    Object.defineProperty(error, "stacktrace", { value: 123 });
    const frames = parseOpera(error);
    expect(frames).toHaveLength(2);
  });

  it("treats non-object errors as having no stacktrace", () => {
    const primitiveError = "boom" as unknown as Error;
    expect(parseOpera10(primitiveError)).toHaveLength(0);
  });
});
