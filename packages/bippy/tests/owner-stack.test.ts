import { describe, expect, it } from "vitest";
import type { Fiber } from "../src/types.js";
import {
  ActivityComponentTag,
  ClassComponentTag,
  ForwardRefTag,
  FunctionComponentTag,
  HostComponentTag,
  LazyComponentTag,
  SuspenseComponentTag,
  SuspenseListComponentTag,
  ViewTransitionComponentTag,
  _renderers,
} from "../src/core.js";
import {
  describeDebugInfoFrame,
  describeFiber,
  formatOwnerStack,
  getFallbackOwnerStack,
  getOwnerStack,
  hasDebugStack,
} from "../src/source/owner-stack.js";

const createFakeFiber = (overrides: Record<string, unknown>): Fiber =>
  ({
    tag: 999,
    type: null,
    child: null,
    sibling: null,
    return: null,
    ...overrides,
  }) as unknown as Fiber;

const createDebugStackError = (stackLines: string[]): Error => {
  const error = new Error("react-stack-top-frame");
  error.stack = stackLines.join("\n");
  return error;
};

const noopFetchFn = (): Promise<Response> =>
  Promise.resolve(new Response("not found", { status: 404 }));

describe("hasDebugStack", () => {
  it("returns true for fibers with an Error debug stack", () => {
    const fiber = createFakeFiber({ _debugStack: new Error("stack") });
    expect(hasDebugStack(fiber)).toBe(true);
  });

  it("returns false for missing or non-error debug stacks", () => {
    expect(hasDebugStack(createFakeFiber({}))).toBe(false);
    expect(hasDebugStack(createFakeFiber({ _debugStack: "at App" }))).toBe(false);
  });

  it("returns false for errors without a string stack", () => {
    const error = new Error("stackless");
    error.stack = undefined;
    expect(hasDebugStack(createFakeFiber({ _debugStack: error }))).toBe(false);
  });
});

describe("describeDebugInfoFrame", () => {
  it("describes a frame without an environment", () => {
    expect(describeDebugInfoFrame("TodoItem")).toBe("\n    in TodoItem");
  });

  it("describes a frame with an environment", () => {
    expect(describeDebugInfoFrame("TodoItem", "Server")).toBe("\n    in TodoItem (at Server)");
  });
});

describe("formatOwnerStack", () => {
  it("returns an empty string for an empty stack", () => {
    expect(formatOwnerStack("")).toBe("");
  });

  it("strips the error prefix, the JSX frame, and internals below the bottom frame", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at TodoItem (rsc://React/Server/file:///proj/chunk.js:10:5)",
      "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
    ].join("\n");
    expect(formatOwnerStack(stack)).toBe(
      "    at TodoItem (rsc://React/Server/file:///proj/chunk.js:10:5)",
    );
  });

  it("supports the underscore variant of the bottom frame", () => {
    const stack = [
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at TodoItem (http://localhost/chunk.js:10:5)",
      "    at react_stack_bottom_frame (http://localhost/chunk.js:2:2)",
    ].join("\n");
    expect(formatOwnerStack(stack)).toBe("    at TodoItem (http://localhost/chunk.js:10:5)");
  });

  it("returns an empty string when no bottom frame exists", () => {
    const stack = [
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at TodoItem (http://localhost/chunk.js:10:5)",
    ].join("\n");
    expect(formatOwnerStack(stack)).toBe("");
  });

  it("returns an empty string for a single-line stack", () => {
    expect(formatOwnerStack("    at onlyFrame (http://localhost/chunk.js:1:1)")).toBe("");
  });
});

describe("describeFiber built-in frames", () => {
  it("describes built-in component tags", () => {
    expect(describeFiber(createFakeFiber({ tag: ActivityComponentTag }), null)).toBe(
      "\n    in Activity",
    );
    expect(describeFiber(createFakeFiber({ tag: HostComponentTag, type: "div" }), null)).toBe(
      "\n    in div",
    );
    expect(describeFiber(createFakeFiber({ tag: LazyComponentTag }), null)).toBe("\n    in Lazy");
    expect(describeFiber(createFakeFiber({ tag: SuspenseListComponentTag }), null)).toBe(
      "\n    in SuspenseList",
    );
    expect(describeFiber(createFakeFiber({ tag: ViewTransitionComponentTag }), null)).toBe(
      "\n    in ViewTransition",
    );
  });

  it("describes suspense content and fallback frames", () => {
    const contentChild = createFakeFiber({});
    const fallbackChild = createFakeFiber({});
    const suspenseFiber = createFakeFiber({ tag: SuspenseComponentTag, child: contentChild });
    expect(describeFiber(suspenseFiber, contentChild)).toBe("\n    in Suspense");
    expect(describeFiber(suspenseFiber, null)).toBe("\n    in Suspense");
    expect(describeFiber(suspenseFiber, fallbackChild)).toBe("\n    in Suspense Fallback");
  });

  it("returns an empty string for unknown tags", () => {
    expect(describeFiber(createFakeFiber({ tag: 999 }), null)).toBe("");
  });
});

describe("describeFiber native component frames", () => {
  it("returns an empty string for a missing component", () => {
    expect(describeFiber(createFakeFiber({ tag: ClassComponentTag, type: null }), null)).toBe("");
  });

  it("extracts the call site frame from a throwing function component", () => {
    const ThrowingFunctionComponent = (): null => {
      throw new Error("intentional");
    };
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: ThrowingFunctionComponent }),
      null,
    );
    expect(frame).toContain("ThrowingFunctionComponent");
    expect(frame).toContain("owner-stack.test.ts");
  });

  it("returns the cached frame on repeated calls", () => {
    const CachedThrowingComponent = (): null => {
      throw new Error("intentional");
    };
    const fiber = createFakeFiber({ tag: FunctionComponentTag, type: CachedThrowingComponent });
    const firstFrame = describeFiber(fiber, null);
    const secondFrame = describeFiber(fiber, null);
    expect(secondFrame).toBe(firstFrame);
  });

  it("falls back to a synthetic frame for components that render without throwing", () => {
    const QuietComponent = (): null => null;
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: QuietComponent }),
      null,
    );
    expect(frame).toBe("\n    in QuietComponent");
  });

  it("falls back to a synthetic frame for components that throw non-errors", () => {
    const StringThrowingComponent = (): null => {
      throw "string failure";
    };
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: StringThrowingComponent }),
      null,
    );
    expect(frame).toBe("\n    in StringThrowingComponent");
  });

  it("returns an empty frame for anonymous components without display names", () => {
    const anonymousComponents: Array<() => null> = [() => null];
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: anonymousComponents[0] }),
      null,
    );
    expect(frame).toBe("");
  });

  it("falls back to a synthetic frame when a class is invoked as a function component", () => {
    class ClassInvokedAsFunction {
      render(): null {
        return null;
      }
    }
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: ClassInvokedAsFunction }),
      null,
    );
    expect(frame).toBe("\n    in ClassInvokedAsFunction");
  });

  it("splices display names into anonymous eval frames", () => {
    const AnonymousEvalComponent = Object.assign(
      new Function('throw new Error("anonymous component failure")'),
      { displayName: "NamedAnonymousComponent" },
    );
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: AnonymousEvalComponent }),
      null,
    );
    expect(frame).toContain("NamedAnonymousComponent");
  });

  it("falls back to a synthetic frame for async components", () => {
    const AsyncComponent = async (): Promise<null> => null;
    const frame = describeFiber(
      createFakeFiber({ tag: FunctionComponentTag, type: AsyncComponent }),
      null,
    );
    expect(frame).toBe("\n    in AsyncComponent");
  });

  it("extracts frames from forwardRef render functions", () => {
    const throwingRender = (): null => {
      throw new Error("intentional");
    };
    const frame = describeFiber(
      createFakeFiber({ tag: ForwardRefTag, type: { render: throwingRender } }),
      null,
    );
    expect(frame).toContain("throwingRender");
  });

  it("extracts frames from class components via construction", () => {
    class ThrowingPropsClass {
      props: Record<string, unknown>;
      constructor() {
        this.props = {};
      }
    }
    const frame = describeFiber(
      createFakeFiber({ tag: ClassComponentTag, type: ThrowingPropsClass }),
      null,
    );
    expect(frame).toContain("ThrowingPropsClass");
  });

  it("falls back to Function.call construction when Reflect is unavailable", () => {
    const originalReflect = globalThis.Reflect;
    // @ts-expect-error -- intentionally removing Reflect to exercise the legacy path
    delete globalThis.Reflect;
    try {
      class NoReflectClassComponent {
        props: Record<string, unknown>;
        constructor() {
          this.props = {};
        }
      }
      const frame = describeFiber(
        createFakeFiber({ tag: ClassComponentTag, type: NoReflectClassComponent }),
        null,
      );
      expect(frame).toContain("NoReflectClassComponent");
    } finally {
      globalThis.Reflect = originalReflect;
    }
  });

  it("returns a synthetic frame when stack traces are too truncated to compare", () => {
    const previousStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 1;
    try {
      const TruncatedStackComponent = (): null => {
        throw new Error("intentional");
      };
      const frame = describeFiber(
        createFakeFiber({ tag: FunctionComponentTag, type: TruncatedStackComponent }),
        null,
      );
      expect(frame).toBe("\n    in TruncatedStackComponent");
    } finally {
      Error.stackTraceLimit = previousStackTraceLimit;
    }
  });

  it("uses a dispatcher ref with a current property when available", () => {
    const legacyDispatcherRef = { current: { placeholder: true } };
    const rendererWithoutRef = { currentDispatcherRef: null };
    const legacyRenderer = { currentDispatcherRef: legacyDispatcherRef };
    _renderers.add(rendererWithoutRef as unknown as never);
    _renderers.add(legacyRenderer as unknown as never);
    try {
      const LegacyDispatcherComponent = (): null => {
        throw new Error("intentional");
      };
      const frame = describeFiber(
        createFakeFiber({ tag: FunctionComponentTag, type: LegacyDispatcherComponent }),
        null,
      );
      expect(frame).toContain("LegacyDispatcherComponent");
      expect(legacyDispatcherRef.current).toEqual({ placeholder: true });
    } finally {
      _renderers.delete(rendererWithoutRef as unknown as never);
      _renderers.delete(legacyRenderer as unknown as never);
    }
  });
});

describe("getFallbackOwnerStack", () => {
  it("walks the return chain and appends debug info frames in reverse", () => {
    const rootFiber = createFakeFiber({
      _debugInfo: [{ name: "ServerRoot", env: "Server" }, { name: 42 }, { name: "ServerLeaf" }],
    });
    const childFiber = createFakeFiber({ tag: HostComponentTag, type: "span", return: rootFiber });
    const stack = getFallbackOwnerStack(childFiber);
    expect(stack).toBe("\n    in span\n    in ServerLeaf\n    in ServerRoot (at Server)");
  });

  it("reports errors thrown while walking the tree", () => {
    const explodingFiber = createFakeFiber({});
    Object.defineProperty(explodingFiber, "return", {
      get() {
        throw new Error("fiber walk exploded");
      },
    });
    const stack = getFallbackOwnerStack(explodingFiber);
    expect(stack).toContain("Error generating stack: fiber walk exploded");
  });

  it("returns an empty string for non-error throws while walking", () => {
    const explodingFiber = createFakeFiber({});
    Object.defineProperty(explodingFiber, "return", {
      get() {
        throw "not an error";
      },
    });
    expect(getFallbackOwnerStack(explodingFiber)).toBe("");
  });
});

describe("getOwnerStack server frame enrichment", () => {
  it("enriches server frames with locations from rsc debug stacks", async () => {
    const debugStack = createDebugStackError([
      "Error: react-stack-top-frame",
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at TodoItem (rsc://React/Server/file:///proj/server-chunk.js:10:5)",
      "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
    ]);
    const fiber = createFakeFiber({
      _debugStack: debugStack,
      _debugInfo: [{ name: "TodoItem", env: "Server" }],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("TodoItem");
    expect(frames[0].isServer).toBe(true);
    expect(frames[0].fileName).toBe("rsc://React/Server/file:///proj/server-chunk.js");
    expect(frames[0].lineNumber).toBe(10);
    expect(frames[0].columnNumber).toBe(5);
    expect(frames[0].source).toBe(
      "    in TodoItem (rsc://React/Server/file:///proj/server-chunk.js:10:5)",
    );
  });

  it("marks server frames without a function name", async () => {
    const fiber = createFakeFiber({
      _debugInfo: [{ name: "", env: "Server" }],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames).toHaveLength(1);
    expect(frames[0].isServer).toBe(true);
    expect(frames[0].functionName).toBe("");
  });

  it("marks server frames without matching rsc frames", async () => {
    const fiber = createFakeFiber({
      _debugInfo: [{ name: "LonelyServerComponent", env: "Server" }],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames).toHaveLength(1);
    expect(frames[0].isServer).toBe(true);
    expect(frames[0].fileName).toBeUndefined();
  });

  it("matches frames via the environment suffix pattern", async () => {
    const fiber = createFakeFiber({
      _debugInfo: [{ name: "EdgeComponent", env: "Edge" }],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames[0].isServer).toBe(true);
    expect(frames[0].functionName).toBe("EdgeComponent");
  });

  it("rotates through duplicate rsc frames for repeated component names", async () => {
    const debugStack = createDebugStackError([
      "Error: react-stack-top-frame",
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at Item (rsc://React/Server/file:///proj/server-chunk.js:10:5)",
      "    at Item (rsc://React/Server/file:///proj/server-chunk.js:10:5)",
      "    at Item (rsc://React/Server/file:///proj/server-chunk.js:20:7)",
      "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
    ]);
    const fiber = createFakeFiber({
      _debugStack: debugStack,
      _debugInfo: [
        { name: "Item", env: "Server" },
        { name: "Spacer", env: "Server" },
        { name: "Item", env: "Server" },
      ],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    const itemFrames = frames.filter((frame) => frame.functionName === "Item");
    expect(itemFrames).toHaveLength(2);
    expect(itemFrames.map((frame) => frame.lineNumber).sort()).toEqual([10, 20]);
  });

  it("collects rsc frames from string-typed fibers in the return chain", async () => {
    const debugStack = createDebugStackError([
      "Error: react-stack-top-frame",
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at HostThing (rsc://React/Server/file:///proj/server-chunk.js:3:1)",
      "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
    ]);
    const parentFiber = createFakeFiber({ type: "div", _debugStack: debugStack });
    const fiber = createFakeFiber({
      return: parentFiber,
      _debugInfo: [{ name: "HostThing", env: "Server" }],
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames[0].fileName).toBe("rsc://React/Server/file:///proj/server-chunk.js");
  });

  it("deduplicates consecutive frames with the same function name", async () => {
    const rootFiber = createFakeFiber({ tag: HostComponentTag, type: "div" });
    const childFiber = createFakeFiber({
      tag: HostComponentTag,
      type: "div",
      return: rootFiber,
    });
    const frames = await getOwnerStack(childFiber, false, noopFetchFn);
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("div");
  });
});
