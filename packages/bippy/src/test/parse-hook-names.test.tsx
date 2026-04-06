import "../index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it } from "vitest";
import {
  getHookSourceLocationKey,
  extractHookVariableName,
  type HookNames,
} from "../source/parse-hook-names.js";
import type { HookSource } from "../source/inspect-hooks.js";

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
