import "../index.js"; // KEEP THIS LINE ON TOP

import { encode } from "@jridgewell/sourcemap-codec";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHookSourceLocationKey,
  extractHookVariableName,
  parseHookNames,
  type HookNames,
} from "../source/parse-hook-names.js";
import type { HookSource, HooksNode } from "../source/inspect-hooks.js";

const createHookSource = (
  fileName: string,
  lineNumber: number,
  columnNumber: number,
): HookSource => ({
  fileName,
  lineNumber,
  columnNumber,
  functionName: null,
});

describe("getHookSourceLocationKey", () => {
  it("creates a key from a hook source", () => {
    const hookSource = createHookSource("App.tsx", 10, 25);
    const key = getHookSourceLocationKey(hookSource);
    expect(key).toBe("App.tsx:10:25");
  });

  it("handles null values with defaults", () => {
    const hookSource: HookSource = {
      fileName: null,
      lineNumber: null,
      columnNumber: null,
      functionName: null,
    };
    const key = getHookSourceLocationKey(hookSource);
    expect(key).toBe(":0:0");
  });

  it("produces unique keys for different locations", () => {
    const sourceA = createHookSource("App.tsx", 10, 25);
    const sourceB = createHookSource("App.tsx", 10, 30);
    const sourceC = createHookSource("Other.tsx", 10, 25);

    const keyA = getHookSourceLocationKey(sourceA);
    const keyB = getHookSourceLocationKey(sourceB);
    const keyC = getHookSourceLocationKey(sourceC);

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    expect(keyB).not.toBe(keyC);
  });
});

describe("extractHookVariableName", () => {
  it("extracts name from destructured useState", () => {
    const source = `const [count, setCount] = useState(0);`;
    const columnOfHookCall = source.indexOf("useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("count");
  });

  it("extracts name from simple useRef", () => {
    const source = `const inputRef = useRef(null);`;
    const columnOfHookCall = source.indexOf("useRef");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("inputRef");
  });

  it("extracts name from useMemo", () => {
    const source = `const filteredItems = useMemo(() => items.filter(Boolean), [items]);`;
    const columnOfHookCall = source.indexOf("useMemo");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("filteredItems");
  });

  it("extracts name from custom hook", () => {
    const source = `const userData = useUserData(userId);`;
    const columnOfHookCall = source.indexOf("useUserData");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("userData");
  });

  it("extracts name from React.useState", () => {
    const source = `const [value, setValue] = React.useState("");`;
    const columnOfHookCall = source.indexOf("React.useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("value");
  });

  it("extracts name from let declaration", () => {
    const source = `let counter = useCounter(0);`;
    const columnOfHookCall = source.indexOf("useCounter");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("counter");
  });

  it("extracts name with TypeScript generics", () => {
    const source = `const [count, setCount] = useState<number>(0);`;
    const columnOfHookCall = source.indexOf("useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("count");
  });

  it("handles multi-line destructuring", () => {
    const source = ["const [", "  count,", "  setCount,", "] = useState(0);"].join("\n");
    const lastLine = 4;
    const columnOfHookCall = source.split("\n")[lastLine - 1].indexOf("useState");
    expect(extractHookVariableName(source, lastLine, columnOfHookCall)).toBe("count");
  });

  it("returns null for hook calls without variable assignment", () => {
    const source = `useEffect(() => {}, []);`;
    const columnOfHookCall = source.indexOf("useEffect");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBeNull();
  });

  it("returns null for out-of-bounds line numbers", () => {
    const source = `const [x] = useState(0);`;
    expect(extractHookVariableName(source, 999, 0)).toBeNull();
  });

  it("handles namespaced hook from a library", () => {
    const source = `const query = ReactQuery.useQuery({ queryKey: ["todos"] });`;
    const columnOfHookCall = source.indexOf("ReactQuery.useQuery");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("query");
  });

  it("extracts name from useReducer", () => {
    const source = `const [state, dispatch] = useReducer(reducer, initialState);`;
    const columnOfHookCall = source.indexOf("useReducer");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("state");
  });

  it("extracts name from useCallback", () => {
    const source = `const handleClick = useCallback(() => {}, []);`;
    const columnOfHookCall = source.indexOf("useCallback");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("handleClick");
  });

  it("handles hook on a later line in multi-line source", () => {
    const source = [
      "function Component() {",
      "  const [count, setCount] = useState(0);",
      "  const ref = useRef(null);",
      "  return null;",
      "}",
    ].join("\n");
    const refLine = 3;
    const columnOfUseRef = source.split("\n")[refLine - 1].indexOf("useRef");
    expect(extractHookVariableName(source, refLine, columnOfUseRef)).toBe("ref");
  });

  it("handles complex TypeScript generics", () => {
    const source = `const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);`;
    const columnOfHookCall = source.indexOf("useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("items");
  });

  it("handles var declaration", () => {
    const source = `var legacy = useLegacyHook();`;
    const columnOfHookCall = source.indexOf("useLegacyHook");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("legacy");
  });

  it("handles useTransition destructured", () => {
    const source = `const [isPending, startTransition] = useTransition();`;
    const columnOfHookCall = source.indexOf("useTransition");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("isPending");
  });

  it("handles useDeferredValue", () => {
    const source = `const deferredQuery = useDeferredValue(query);`;
    const columnOfHookCall = source.indexOf("useDeferredValue");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("deferredQuery");
  });

  it("handles useSyncExternalStore", () => {
    const source = `const snapshot = useSyncExternalStore(subscribe, getSnapshot);`;
    const columnOfHookCall = source.indexOf("useSyncExternalStore");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("snapshot");
  });

  it("handles useImperativeHandle (no variable)", () => {
    const source = `useImperativeHandle(ref, () => ({ focus: () => {} }));`;
    const columnOfHookCall = source.indexOf("useImperativeHandle");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBeNull();
  });

  it("handles useDebugValue (no variable)", () => {
    const source = `useDebugValue(isOnline ? "Online" : "Offline");`;
    const columnOfHookCall = source.indexOf("useDebugValue");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBeNull();
  });

  it("handles useActionState", () => {
    const source = `const [state, formAction, isPending] = useActionState(action, initialState);`;
    const columnOfHookCall = source.indexOf("useActionState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("state");
  });

  it("handles useOptimistic", () => {
    const source = `const [optimisticCount, addOptimistic] = useOptimistic(count);`;
    const columnOfHookCall = source.indexOf("useOptimistic");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("optimisticCount");
  });

  it("handles hook with extra whitespace around equals", () => {
    const source = `const   [count, setCount]   =   useState(0);`;
    const columnOfHookCall = source.indexOf("useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("count");
  });

  it("picks the correct hook when two declarations share a line", () => {
    const source = `const a = useFirst(); const b = useSecond();`;
    const columnOfSecondHook = source.indexOf("useSecond");
    expect(extractHookVariableName(source, 1, columnOfSecondHook)).toBe("b");
  });

  it("picks the correct hook when two declarations share a line (first hook)", () => {
    const source = `const a = useFirst(); const b = useSecond();`;
    const columnOfFirstHook = source.indexOf("useFirst");
    expect(extractHookVariableName(source, 1, columnOfFirstHook)).toBe("a");
  });

  it("handles deeply nested generics", () => {
    const source = `const [data, setData] = useState<Map<string, Set<number>>>(new Map());`;
    const columnOfHookCall = source.indexOf("useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("data");
  });

  it("handles multi-line with indentation and blank lines", () => {
    const source = [
      "function Component() {",
      "",
      "  const [",
      "    value,",
      "    setValue,",
      "  ] = useState(0);",
      "",
      "  return null;",
      "}",
    ].join("\n");
    const hookLine = 6;
    const columnOfHookCall = source.split("\n")[hookLine - 1].indexOf("useState");
    expect(extractHookVariableName(source, hookLine, columnOfHookCall)).toBe("value");
  });

  it("handles hook after comments on preceding lines", () => {
    const source = ["// This is the count state", "const [count, setCount] = useState(0);"].join(
      "\n",
    );
    const hookLine = 2;
    const columnOfHookCall = source.split("\n")[hookLine - 1].indexOf("useState");
    expect(extractHookVariableName(source, hookLine, columnOfHookCall)).toBe("count");
  });

  it("handles hook preceded by other non-hook statements", () => {
    const source = [
      "const x = 42;",
      "const y = someFunction();",
      "const [count, setCount] = useState(0);",
    ].join("\n");
    const hookLine = 3;
    const columnOfHookCall = source.split("\n")[hookLine - 1].indexOf("useState");
    expect(extractHookVariableName(source, hookLine, columnOfHookCall)).toBe("count");
  });

  it("handles React.useRef with namespace", () => {
    const source = `const divRef = React.useRef<HTMLDivElement>(null);`;
    const columnOfHookCall = source.indexOf("React.useRef");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("divRef");
  });

  it("handles hook with dollar-sign in namespace", () => {
    const source = `const store = $store.useStore();`;
    const columnOfHookCall = source.indexOf("$store.useStore");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("store");
  });

  it("handles multiple hooks across many lines selecting the right one", () => {
    const source = [
      "function Component() {",
      "  const [a, setA] = useState(1);",
      "  const [b, setB] = useState(2);",
      "  const [c, setC] = useState(3);",
      "  const [d, setD] = useState(4);",
      "  const [e, setE] = useState(5);",
      "  return null;",
      "}",
    ].join("\n");
    const targetLine = 4;
    const columnOfHookCall = source.split("\n")[targetLine - 1].indexOf("useState");
    expect(extractHookVariableName(source, targetLine, columnOfHookCall)).toBe("c");
  });

  it("returns null for negative line number", () => {
    expect(extractHookVariableName("const x = useState(0);", -1, 0)).toBeNull();
  });

  it("returns null for line number zero", () => {
    expect(extractHookVariableName("const x = useState(0);", 0, 0)).toBeNull();
  });

  it("returns null for empty source", () => {
    expect(extractHookVariableName("", 1, 0)).toBeNull();
  });

  it("handles destructured with renamed variables", () => {
    const source = `const [count, setCount] = React.useState<number>(0);`;
    const columnOfHookCall = source.indexOf("React.useState");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("count");
  });

  it("handles hook with arrow function argument spanning lines", () => {
    const source = [
      "const memoized = useMemo(",
      "  () => expensiveComputation(a, b),",
      "  [a, b],",
      ");",
    ].join("\n");
    const hookLine = 1;
    const columnOfHookCall = source.split("\n")[hookLine - 1].indexOf("useMemo");
    expect(extractHookVariableName(source, hookLine, columnOfHookCall)).toBe("memoized");
  });

  it("handles single-element destructuring", () => {
    const source = `const [only] = useCustomHook();`;
    const columnOfHookCall = source.indexOf("useCustomHook");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("only");
  });

  it("handles empty destructuring pattern", () => {
    const source = `const [] = useCustomHook();`;
    const columnOfHookCall = source.indexOf("useCustomHook");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBeNull();
  });

  it("handles column at very start of line", () => {
    const source = `useState(0);`;
    expect(extractHookVariableName(source, 1, 0)).toBeNull();
  });

  it("handles deeply nested namespace", () => {
    const source = `const value = Pkg.Sub.useHook();`;
    const columnOfHookCall = source.indexOf("Pkg.Sub.useHook");
    expect(extractHookVariableName(source, 1, columnOfHookCall)).toBe("value");
  });
});

const createHooksNode = (overrides: Partial<HooksNode>): HooksNode => ({
  id: 0,
  isStateEditable: true,
  name: "State",
  value: 0,
  subHooks: [],
  hookSource: null,
  ...overrides,
});

describe("parseHookNames", () => {
  it("returns an empty map for an empty hooks tree", async () => {
    const hookNames = await parseHookNames([]);
    expect(hookNames.size).toBe(0);
  });

  it("skips hooks without complete source information", async () => {
    let fetchCount = 0;
    const fetchFn = (): Promise<Response> => {
      fetchCount++;
      return Promise.resolve(new Response("", { status: 404 }));
    };
    const hookNames = await parseHookNames(
      [
        createHooksNode({ hookSource: null }),
        createHooksNode({
          hookSource: { fileName: null, lineNumber: 1, columnNumber: 1, functionName: null },
        }),
        createHooksNode({
          hookSource: { fileName: "a.js", lineNumber: null, columnNumber: 1, functionName: null },
        }),
        createHooksNode({
          hookSource: { fileName: "a.js", lineNumber: 1, columnNumber: null, functionName: null },
        }),
      ],
      fetchFn,
    );
    expect(hookNames.size).toBe(0);
    expect(fetchCount).toBe(0);
  });

  it("skips unnamed hooks like effects", async () => {
    let fetchCount = 0;
    const fetchFn = (): Promise<Response> => {
      fetchCount++;
      return Promise.resolve(new Response("", { status: 404 }));
    };
    const hookNames = await parseHookNames(
      [
        createHooksNode({
          name: "Effect",
          hookSource: { fileName: "a.js", lineNumber: 1, columnNumber: 1, functionName: null },
        }),
      ],
      fetchFn,
    );
    expect(hookNames.size).toBe(0);
    expect(fetchCount).toBe(0);
  });

  it("resolves hook names through a source map", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-mapped.js";
    const hookSourceLine = "const [count, setCount] = useState(0);";
    const hookColumn = hookSourceLine.indexOf("useState");
    const rawMap = JSON.stringify({
      version: 3,
      sources: ["src/use-counter.tsx"],
      sourcesContent: [hookSourceLine],
      names: [],
      mappings: encode([[[0, 0, 0, hookColumn]]]),
    });
    const fetchFn = (url: string): Promise<Response> =>
      Promise.resolve(
        url.endsWith(".map")
          ? new Response(rawMap, { status: 200 })
          : new Response("const bundled = 1;\n//# sourceMappingURL=hooks-bundle-mapped.js.map", {
              status: 200,
            }),
      );

    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 1,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:1:0`)).toBe("count");
  });

  it("resolves hook names from index source map sections", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-sections.js";
    const hookSourceLine = "const [flag, setFlag] = useState(false);";
    const hookColumn = hookSourceLine.indexOf("useState");
    const rawMap = JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sources: ["src/use-flag.tsx"],
            sourcesContent: [hookSourceLine],
            names: [],
            mappings: encode([[[0, 0, 0, hookColumn]]]),
          },
        },
      ],
    });
    const fetchFn = (url: string): Promise<Response> =>
      Promise.resolve(
        url.endsWith(".map")
          ? new Response(rawMap, { status: 200 })
          : new Response("const bundled = 1;\n//# sourceMappingURL=hooks-bundle-sections.js.map", {
              status: 200,
            }),
      );

    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 1,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:1:0`)).toBe("flag");
  });

  it("reuses cached source content for hooks resolved through the same map", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-shared.js";
    const originalSourceLines = [
      "const [first, setFirst] = useState(1);",
      "const [second, setSecond] = useState(2);",
    ];
    const firstHookColumn = originalSourceLines[0].indexOf("useState");
    const secondHookColumn = originalSourceLines[1].indexOf("useState");
    const rawMap = JSON.stringify({
      version: 3,
      sources: ["src/use-shared.tsx"],
      sourcesContent: [originalSourceLines.join("\n")],
      names: [],
      mappings: encode([[[0, 0, 0, firstHookColumn]], [[0, 0, 1, secondHookColumn]]]),
    });
    const fetchFn = (url: string): Promise<Response> =>
      Promise.resolve(
        url.endsWith(".map")
          ? new Response(rawMap, { status: 200 })
          : new Response("const bundled = 1;\n//# sourceMappingURL=hooks-bundle-shared.js.map", {
              status: 200,
            }),
      );

    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: { fileName: runtimeFile, lineNumber: 1, columnNumber: 0, functionName: null },
        }),
        createHooksNode({
          id: 1,
          hookSource: { fileName: runtimeFile, lineNumber: 2, columnNumber: 0, functionName: null },
        }),
        createHooksNode({
          id: 2,
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 99,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:1:0`)).toBe("first");
    expect(hookNames.get(`${runtimeFile}:2:0`)).toBe("second");
    expect(hookNames.has(`${runtimeFile}:99:0`)).toBe(false);
  });

  it("finds source content in a later index map section", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-multi-section.js";
    const hookSourceLine = "const [nested, setNested] = useState(0);";
    const hookColumn = hookSourceLine.indexOf("useState");
    const rawMap = JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sources: ["src/first-section.tsx"],
            sourcesContent: ["// first section"],
            names: [],
            mappings: encode([[[0, 0, 0, 0]]]),
          },
        },
        {
          offset: { line: 10, column: 0 },
          map: {
            version: 3,
            sources: ["src/second-section.tsx"],
            sourcesContent: [hookSourceLine],
            names: [],
            mappings: encode([[[0, 0, 0, hookColumn]]]),
          },
        },
      ],
    });
    const fetchFn = (url: string): Promise<Response> =>
      Promise.resolve(
        url.endsWith(".map")
          ? new Response(rawMap, { status: 200 })
          : new Response(
              "const bundled = 1;\n//# sourceMappingURL=hooks-bundle-multi-section.js.map",
              { status: 200 },
            ),
      );

    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 11,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:11:0`)).toBe("nested");
  });

  it("falls back to runtime coordinates when the content array is shorter than sources", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-short-content.js";
    const runtimeSource = "const [partial] = useState(1);";
    const rawMap = JSON.stringify({
      version: 3,
      sources: ["src/other.tsx", "src/use-partial.tsx"],
      sourcesContent: ["// only the first source has content"],
      names: [],
      mappings: encode([[[0, 1, 0, 0]]]),
    });
    const fetchFn = (url: string): Promise<Response> => {
      if (url.endsWith(".map")) return Promise.resolve(new Response(rawMap, { status: 200 }));
      return Promise.resolve(
        new Response(`${runtimeSource}\n//# sourceMappingURL=hooks-bundle-short-content.js.map`, {
          status: 200,
        }),
      );
    };

    const hookColumn = runtimeSource.indexOf("useState");
    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 1,
            columnNumber: hookColumn,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:1:${hookColumn}`)).toBe("partial");
  });

  it("falls back to fetching the runtime file when there is no source map", async () => {
    const runtimeFile = "http://localhost/hooks-runtime-plain.js";
    const paddingLines = Array.from({ length: 11 }, () => "// padding");
    const runtimeSource = [
      "const counter = useCounter(0);",
      "const [count, setCount] = useState(0);",
      ...paddingLines,
      "useEffect(() => {}, []);",
    ].join("\n");
    const fetchFn = (): Promise<Response> =>
      Promise.resolve(new Response(runtimeSource, { status: 200 }));

    const customHookSource = {
      fileName: runtimeFile,
      lineNumber: 1,
      columnNumber: runtimeSource.indexOf("useCounter"),
      functionName: null,
    };
    const stateNode = createHooksNode({
      hookSource: {
        fileName: runtimeFile,
        lineNumber: 2,
        columnNumber: runtimeSource.split("\n")[1].indexOf("useState"),
        functionName: null,
      },
    });
    const effectLineNumber = 3 + paddingLines.length;
    const unnamedNode = createHooksNode({
      id: 1,
      hookSource: {
        fileName: runtimeFile,
        lineNumber: effectLineNumber,
        columnNumber: 0,
        functionName: null,
      },
    });
    const customHookNode = createHooksNode({
      id: null,
      isStateEditable: false,
      name: "Counter",
      hookSource: customHookSource,
      subHooks: [stateNode],
    });

    const hookNames = await parseHookNames([customHookNode, unnamedNode], fetchFn);

    expect(hookNames.get(`${runtimeFile}:1:${customHookSource.columnNumber}`)).toBe("counter");
    expect(hookNames.get(getHookSourceLocationKey(stateNode.hookSource!))).toBe("count");
    expect(hookNames.has(`${runtimeFile}:${effectLineNumber}:0`)).toBe(false);
  });

  it("falls back to runtime coordinates when the map lacks the source content", async () => {
    const runtimeFile = "http://localhost/hooks-bundle-no-content.js";
    const runtimeSource = "const [value] = useState(1);";
    const rawMap = JSON.stringify({
      version: 3,
      sources: ["src/use-value.tsx"],
      names: [],
      mappings: encode([[[0, 0, 0, 0]]]),
    });
    const fetchFn = (url: string): Promise<Response> => {
      if (url.endsWith(".map")) return Promise.resolve(new Response(rawMap, { status: 200 }));
      return Promise.resolve(
        new Response(`${runtimeSource}\n//# sourceMappingURL=hooks-bundle-no-content.js.map`, {
          status: 200,
        }),
      );
    };

    const hookColumn = runtimeSource.indexOf("useState");
    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 1,
            columnNumber: hookColumn,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );

    expect(hookNames.get(`${runtimeFile}:1:${hookColumn}`)).toBe("value");
  });

  describe("global fetch fallback", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("uses the global fetch when no fetch function is provided", async () => {
      const runtimeFile = "http://localhost/hooks-global-fetch.js";
      const runtimeSource = "const [globalValue] = useState(0);";
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            url.endsWith(".map")
              ? new Response("not found", { status: 404 })
              : new Response(runtimeSource, { status: 200 }),
          ),
        ),
      );

      const hookColumn = runtimeSource.indexOf("useState");
      const hookNames = await parseHookNames([
        createHooksNode({
          hookSource: {
            fileName: runtimeFile,
            lineNumber: 1,
            columnNumber: hookColumn,
            functionName: null,
          },
        }),
      ]);

      expect(hookNames.get(`${runtimeFile}:1:${hookColumn}`)).toBe("globalValue");
    });
  });

  it("returns no names when the runtime file cannot be fetched", async () => {
    const fetchFn = (): Promise<Response> =>
      Promise.resolve(new Response("missing", { status: 404 }));
    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: "http://localhost/hooks-missing.js",
            lineNumber: 1,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );
    expect(hookNames.size).toBe(0);
  });

  it("returns no names when fetching throws", async () => {
    const fetchFn = (): Promise<Response> => Promise.reject(new Error("network down"));
    const hookNames = await parseHookNames(
      [
        createHooksNode({
          hookSource: {
            fileName: "http://localhost/hooks-throwing.js",
            lineNumber: 1,
            columnNumber: 0,
            functionName: null,
          },
        }),
      ],
      fetchFn,
    );
    expect(hookNames.size).toBe(0);
  });
});

describe("HookNames map integration", () => {
  it("allows lookup by location key", () => {
    const hookNames: HookNames = new Map();
    const hookSource = createHookSource("App.tsx", 10, 25);
    const key = getHookSourceLocationKey(hookSource);
    hookNames.set(key, "count");

    expect(hookNames.get(getHookSourceLocationKey(hookSource))).toBe("count");
  });

  it("returns undefined for unknown locations", () => {
    const hookNames: HookNames = new Map();
    hookNames.set("App.tsx:10:25", "count");

    const unknownSource = createHookSource("Other.tsx", 5, 10);
    expect(hookNames.get(getHookSourceLocationKey(unknownSource))).toBeUndefined();
  });
});
