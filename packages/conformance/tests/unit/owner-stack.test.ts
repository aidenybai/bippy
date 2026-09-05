import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { _renderers } from "../../../bippy/src/core.js";
import {
  describeDebugInfoFrame,
  describeFiber,
  formatOwnerStack,
  getFallbackParentStack,
  getOwnerStack,
  getParentStack,
  hasDebugStack,
} from "../../../bippy/src/source/owner-stack.js";
import { latestReactWorkTags } from "./react-work-tags.js";
import { sourceFetch as noopFetchFn } from "./source-fetch.js";

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
    expect(describeDebugInfoFrame("TodoItem", "Server")).toBe("\n    in TodoItem [Server]");
  });

  it("uses a matching debug location", () => {
    const location = new Error("react-stack-top-frame");
    location.stack = [
      "Error: react-stack-top-frame",
      "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
      "    at TodoItem (http://localhost/app.js:10:5)",
      "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
    ].join("\n");
    expect(describeDebugInfoFrame("TodoItem", "Server", location)).toBe(
      "\n    at TodoItem (http://localhost/app.js:10:5)",
    );
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
    expect(
      describeFiber(createFakeFiber({ tag: latestReactWorkTags.ActivityComponent }), null),
    ).toBe("\n    in Activity");
    expect(
      describeFiber(createFakeFiber({ tag: latestReactWorkTags.HostComponent, type: "div" }), null),
    ).toBe("\n    in div");
    expect(describeFiber(createFakeFiber({ tag: latestReactWorkTags.LazyComponent }), null)).toBe(
      "\n    in Lazy",
    );
    expect(
      describeFiber(createFakeFiber({ tag: latestReactWorkTags.SuspenseListComponent }), null),
    ).toBe("\n    in SuspenseList");
    expect(
      describeFiber(createFakeFiber({ tag: latestReactWorkTags.ViewTransitionComponent }), null),
    ).toBe("\n    in ViewTransition");
  });

  it("describes suspense content and fallback frames", () => {
    const contentChild = createFakeFiber({});
    const fallbackChild = createFakeFiber({});
    const suspenseFiber = createFakeFiber({
      tag: latestReactWorkTags.SuspenseComponent,
      child: contentChild,
    });
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
    expect(
      describeFiber(createFakeFiber({ tag: latestReactWorkTags.ClassComponent, type: null }), null),
    ).toBe("");
  });

  it("extracts the call site frame from a throwing function component", () => {
    const ThrowingFunctionComponent = (): null => {
      throw new Error("intentional");
    };
    const frame = describeFiber(
      createFakeFiber({
        tag: latestReactWorkTags.FunctionComponent,
        type: ThrowingFunctionComponent,
      }),
      null,
    );
    expect(frame).toContain("ThrowingFunctionComponent");
    expect(frame).toContain("owner-stack.test.ts");
  });

  it("returns the cached frame on repeated calls", () => {
    const CachedThrowingComponent = (): null => {
      throw new Error("intentional");
    };
    const fiber = createFakeFiber({
      tag: latestReactWorkTags.FunctionComponent,
      type: CachedThrowingComponent,
    });
    const firstFrame = describeFiber(fiber, null);
    const secondFrame = describeFiber(fiber, null);
    expect(secondFrame).toBe(firstFrame);
  });

  it("falls back to a synthetic frame for components that render without throwing", () => {
    const QuietComponent = (): null => null;
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.FunctionComponent, type: QuietComponent }),
      null,
    );
    expect(frame).toBe("\n    in QuietComponent");
  });

  it("falls back to a synthetic frame for components that throw non-errors", () => {
    const StringThrowingComponent = (): null => {
      throw "string failure";
    };
    const frame = describeFiber(
      createFakeFiber({
        tag: latestReactWorkTags.FunctionComponent,
        type: StringThrowingComponent,
      }),
      null,
    );
    expect(frame).toBe("\n    in StringThrowingComponent");
  });

  it("does not return native bridge frames from component stack comparison", () => {
    const NativeBridgeComponent = (): null => {
      const nativeError = new Error("native bridge");
      nativeError.stack = "Error: native bridge\n    at apply (native)";
      throw nativeError;
    };
    const frame = describeFiber(
      createFakeFiber({
        tag: latestReactWorkTags.FunctionComponent,
        type: NativeBridgeComponent,
      }),
      null,
    );
    expect(frame).toBe("\n    in NativeBridgeComponent");
  });

  it("returns an empty frame for anonymous components without display names", () => {
    const anonymousComponents: Array<() => null> = [() => null];
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.FunctionComponent, type: anonymousComponents[0] }),
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
      createFakeFiber({ tag: latestReactWorkTags.FunctionComponent, type: ClassInvokedAsFunction }),
      null,
    );
    expect(frame).toBe("\n    in ClassInvokedAsFunction");
  });

  it("splices display names into anonymous eval frames", () => {
    const AnonymousEvalComponent = Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- This test requires an anonymous eval frame.
      new Function('throw new Error("anonymous component failure")'),
      { displayName: "NamedAnonymousComponent" },
    );
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.FunctionComponent, type: AnonymousEvalComponent }),
      null,
    );
    expect(frame).toContain("NamedAnonymousComponent");
  });

  it("falls back to a synthetic frame for async components", () => {
    const AsyncComponent = async (): Promise<null> => null;
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.FunctionComponent, type: AsyncComponent }),
      null,
    );
    expect(frame).toBe("\n    in AsyncComponent");
  });

  it("extracts frames from forwardRef render functions", () => {
    const throwingRender = (): null => {
      throw new Error("intentional");
    };
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.ForwardRef, type: { render: throwingRender } }),
      null,
    );
    expect(frame).toContain("throwingRender");
  });

  it("extracts frames from memo wrappers retained by custom renderers", () => {
    const ThrowingMemoComponent = (): null => {
      throw new Error("intentional");
    };
    const frame = describeFiber(
      createFakeFiber({
        tag: latestReactWorkTags.SimpleMemoComponent,
        type: { type: ThrowingMemoComponent },
      }),
      null,
    );
    expect(frame).toContain("ThrowingMemoComponent");
    expect(frame).toContain("owner-stack.test.ts");
  });

  it("extracts frames from class components via construction", () => {
    class ThrowingPropsClass {
      props: Record<string, unknown>;
      constructor() {
        this.props = {};
      }
    }
    const frame = describeFiber(
      createFakeFiber({ tag: latestReactWorkTags.ClassComponent, type: ThrowingPropsClass }),
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
        createFakeFiber({ tag: latestReactWorkTags.ClassComponent, type: NoReflectClassComponent }),
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
        createFakeFiber({
          tag: latestReactWorkTags.FunctionComponent,
          type: TruncatedStackComponent,
        }),
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
        createFakeFiber({
          tag: latestReactWorkTags.FunctionComponent,
          type: LegacyDispatcherComponent,
        }),
        null,
      );
      expect(frame).toContain("LegacyDispatcherComponent");
      expect(legacyDispatcherRef.current).toEqual({ placeholder: true });
    } finally {
      _renderers.delete(rendererWithoutRef as unknown as never);
      _renderers.delete(legacyRenderer as unknown as never);
    }
  });

  it("clears and restores each renderer dispatcher independently", () => {
    const legacyValue = { renderer: "legacy" };
    const modernValue = { renderer: "modern" };
    const legacyDispatcherRef = { current: legacyValue };
    const modernDispatcherRef = { H: modernValue };
    const legacyRenderer = { currentDispatcherRef: legacyDispatcherRef };
    const modernRenderer = { currentDispatcherRef: modernDispatcherRef };
    let observedLegacyDispatcher: unknown;
    let observedModernDispatcher: unknown;
    _renderers.add(legacyRenderer as unknown as never);
    _renderers.add(modernRenderer as unknown as never);
    try {
      const MixedRendererComponent = (): null => {
        observedLegacyDispatcher = legacyDispatcherRef.current;
        observedModernDispatcher = modernDispatcherRef.H;
        throw new Error("intentional");
      };
      describeFiber(
        createFakeFiber({
          tag: latestReactWorkTags.FunctionComponent,
          type: MixedRendererComponent,
        }),
        null,
      );
      expect(observedLegacyDispatcher).toBeNull();
      expect(observedModernDispatcher).toBeNull();
      expect(legacyDispatcherRef.current).toBe(legacyValue);
      expect(modernDispatcherRef.H).toBe(modernValue);
    } finally {
      _renderers.delete(legacyRenderer as unknown as never);
      _renderers.delete(modernRenderer as unknown as never);
    }
  });
});

describe("getFallbackParentStack", () => {
  it("walks the return chain and appends debug info frames in reverse", () => {
    const rootFiber = createFakeFiber({
      _debugInfo: [{ name: "ServerRoot", env: "Server" }, { name: 42 }, { name: "ServerLeaf" }],
    });
    const childFiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "span",
      return: rootFiber,
    });
    const stack = getFallbackParentStack(childFiber);
    expect(stack).toBe("\n    in span\n    in ServerLeaf\n    in ServerRoot [Server]");
  });

  it("reports errors thrown while walking the tree", () => {
    const explodingFiber = createFakeFiber({});
    Object.defineProperty(explodingFiber, "return", {
      get() {
        throw new Error("fiber walk exploded");
      },
    });
    const stack = getFallbackParentStack(explodingFiber);
    expect(stack).toContain("Bippy couldn’t generate the stack: fiber walk exploded");
  });

  it("returns an empty string for non-error throws while walking", () => {
    const explodingFiber = createFakeFiber({});
    Object.defineProperty(explodingFiber, "return", {
      get() {
        throw "not an error";
      },
    });
    expect(getFallbackParentStack(explodingFiber)).toBe("");
  });
});

describe("getOwnerStack owner-chain walk", () => {
  it("walks _debugOwner chains and marks flight server frames per-frame", async () => {
    const appFiber = createFakeFiber({
      tag: latestReactWorkTags.FunctionComponent,
      type: function App() {},
    });
    const fiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "p",
      _debugOwner: appFiber,
      _debugStack: createDebugStackError([
        "Error: react-stack-top-frame",
        "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
        "    at ServerCard (about://React/Server/file:///proj/.next/chunks/ssr/chunk.js?8:75:471)",
        "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
      ]),
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    const serverCardFrame = frames.find((frame) => frame.functionName === "ServerCard");
    expect(serverCardFrame?.isServer).toBe(true);
    expect(serverCardFrame?.fileName).toBe(
      "about://React/Server/file:///proj/.next/chunks/ssr/chunk.js?8",
    );
  });

  it("continues through server component owners via their debugStack", async () => {
    const rootOwner = { name: "Root" };
    const serverOwner = {
      name: "ServerCard",
      env: "Server",
      owner: rootOwner,
      debugStack: createDebugStackError([
        "Error: react-stack-top-frame",
        "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
        "    at Page (rsc://React/Server/file:///proj/page.js:12:7)",
      ]),
    };
    const fiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "p",
      _debugOwner: serverOwner,
      _debugStack: createDebugStackError([
        "Error: react-stack-top-frame",
        "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
        "    at ServerCard (rsc://React/Server/file:///proj/server-card.js:5:3)",
        "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
      ]),
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    const functionNames = frames.map((frame) => frame.functionName);
    expect(functionNames).toContain("ServerCard");
    expect(functionNames).toContain("Page");
    expect(frames.every((frame) => frame.functionName === "p" || frame.isServer)).toBe(true);
  });

  it("falls back to the parent walk when no owner frame has a locatable file", async () => {
    const appFiber = createFakeFiber({
      tag: latestReactWorkTags.FunctionComponent,
      type: function App() {},
    });
    const fiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "span",
      return: appFiber,
      _debugOwner: appFiber,
      _debugStack: createDebugStackError([
        "Error: react-stack-top-frame",
        "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
        "    at <anonymous>",
        "    at react-stack-bottom-frame (http://localhost/chunk.js:2:2)",
      ]),
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames.map((frame) => frame.functionName)).toEqual(["span", "App"]);
  });

  it("ignores untrusted debug stacks and falls back to the parent walk", async () => {
    const appFiber = createFakeFiber({
      tag: latestReactWorkTags.FunctionComponent,
      type: function App() {},
    });
    const fiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "span",
      return: appFiber,
      _debugOwner: appFiber,
      _debugStack: createDebugStackError([
        "Error: react-stack-top-frame",
        "    at fakeJSXCallSite (http://localhost/chunk.js:1:1)",
        "    at bootstrap (http://localhost/main.js:1:1)",
      ]),
    });

    const frames = await getOwnerStack(fiber, false, noopFetchFn);

    expect(frames.map((frame) => frame.functionName)).toEqual(["span", "App"]);
  });
});

describe("getParentStack server frame enrichment", () => {
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

    const frames = await getParentStack(fiber, false, noopFetchFn);

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

    const frames = await getParentStack(fiber, false, noopFetchFn);

    expect(frames).toHaveLength(1);
    expect(frames[0].isServer).toBe(true);
    expect(frames[0].functionName).toBe("");
  });

  it("marks server frames without matching rsc frames", async () => {
    const fiber = createFakeFiber({
      _debugInfo: [{ name: "LonelyServerComponent", env: "Server" }],
    });

    const frames = await getParentStack(fiber, false, noopFetchFn);

    expect(frames).toHaveLength(1);
    expect(frames[0].isServer).toBe(true);
    expect(frames[0].fileName).toBeUndefined();
  });

  it("matches frames via the environment suffix pattern", async () => {
    const fiber = createFakeFiber({
      _debugInfo: [{ name: "EdgeComponent", env: "Edge" }],
    });

    const frames = await getParentStack(fiber, false, noopFetchFn);

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

    const frames = await getParentStack(fiber, false, noopFetchFn);

    const itemFrames = frames.filter((frame) => frame.functionName === "Item");
    expect(itemFrames).toHaveLength(2);
    expect(
      itemFrames
        .map((frame) => frame.lineNumber)
        .sort((firstLineNumber, secondLineNumber) =>
          firstLineNumber === null || firstLineNumber === undefined
            ? -1
            : secondLineNumber === null || secondLineNumber === undefined
              ? 1
              : firstLineNumber - secondLineNumber,
        ),
    ).toEqual([10, 20]);
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

    const frames = await getParentStack(fiber, false, noopFetchFn);

    expect(frames[0].fileName).toBe("rsc://React/Server/file:///proj/server-chunk.js");
  });

  it("deduplicates consecutive frames with the same function name", async () => {
    const rootFiber = createFakeFiber({ tag: latestReactWorkTags.HostComponent, type: "div" });
    const childFiber = createFakeFiber({
      tag: latestReactWorkTags.HostComponent,
      type: "div",
      return: rootFiber,
    });
    const frames = await getParentStack(childFiber, false, noopFetchFn);
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBe("div");
  });
});
