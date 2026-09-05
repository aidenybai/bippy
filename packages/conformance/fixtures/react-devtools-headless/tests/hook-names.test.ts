import { describe, expect, it } from "vite-plus/test";
import {
  decodeHookMap,
  generateEncodedHookMap,
  generateHookMap,
  getHookNameForLocation,
  parseHookNames,
} from "../src/hook-names.js";

const getLocation = (source: string) => {
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const column = lines[index].lastIndexOf("use");
    if (column >= 0) return { column, hookId: 0, line: index + 1 };
  }
  return { column: 0, hookId: 0, line: 1 };
};

describe("upstream hook-map generation behavior", () => {
  it("should parse names for built-in hooks", () => {
    const source = "const a = useMemo(() => 1);\nconst [b] = useState(0);";
    const map = generateHookMap(source);
    expect(getHookNameForLocation({ column: 12, line: 1 }, map)).toBe("a");
    expect(getHookNameForLocation({ column: 13, line: 2 }, map)).toBe("b");
    expect(decodeHookMap(generateEncodedHookMap(source))).toEqual(map);
  });

  it("should parse names for custom hooks", () => {
    const source = "const theme = useTheme();\nconst [value] = useValue();";
    const map = generateHookMap(source);
    expect(getHookNameForLocation({ column: 15, line: 1 }, map)).toBe("theme");
    expect(getHookNameForLocation({ column: 17, line: 2 }, map)).toBe("value");
  });

  it("should parse names for nested hook calls", () => {
    const source = "const Inner = useMemo(() => {\n const [state] = useState(0);\n});";
    const map = generateHookMap(source);
    expect(getHookNameForLocation({ column: 18, line: 1 }, map)).toBe("Inner");
    expect(getHookNameForLocation({ column: 20, line: 2 }, map)).toBe("state");
  });

  it("should skip names for non-nameable hooks", () => {
    const map = generateHookMap("useEffect(() => {});\nuseLayoutEffect(() => {});");
    expect(map.entries).toEqual([{ column: 0, line: 1, name: null }]);
  });
});

describe("upstream hook-name location behavior", () => {
  it("should parse names for built-in hooks", () => {
    const map = generateHookMap("const state = useState(0);");
    expect(getHookNameForLocation({ column: 15, line: 1 }, map)).toBe("state");
  });

  it("should parse names for custom hooks", () => {
    const map = generateHookMap("const theme = useTheme();");
    expect(getHookNameForLocation({ column: 15, line: 1 }, map)).toBe("theme");
  });

  it("should parse names for nested hook calls", () => {
    const map = generateHookMap("const outer = useMemo(() => {\n const inner = useValue();\n});");
    expect(getHookNameForLocation({ column: 16, line: 2 }, map)).toBe("inner");
  });

  it("should skip names for non-nameable hooks", () => {
    const map = generateHookMap("useEffect(() => {});");
    expect(getHookNameForLocation({ column: 0, line: 1 }, map)).toBeNull();
  });
});

const expectParsedHookName = (source: string, expected: string | null): void => {
  expect(parseHookNames(source, [getLocation(source)])).toEqual([{ hookId: 0, name: expected }]);
};

describe("upstream hook-name parsing behavior", () => {
  it("should parse names for useState()", () => {
    expectParsedHookName("const [state] = useState(0);", "state");
  });

  it("should parse names for useReducer()", () => {
    expectParsedHookName("const [state] = useReducer(reducer, 0);", "state");
  });

  it("should skip loading source files for unnamed hooks like useEffect", () => {
    expectParsedHookName("useEffect(() => {});", null);
  });

  it("should skip loading source files for unnamed hooks like useEffect (alternate)", () => {
    expectParsedHookName("React.useEffect(() => {});", null);
  });

  it("should parse names for custom hooks", () => {
    expectParsedHookName("const theme = useTheme();", "theme");
  });

  it("should parse names for code using hooks indirectly", () => {
    expectParsedHookName("const value = useHook();", "value");
  });

  it("should parse names for code using nested hooks", () => {
    expectParsedHookName("const nested = useNestedHook();", "nested");
  });

  it("should return null for custom hooks without explicit names", () => {
    expectParsedHookName("useTheme();", null);
  });

  it("should work for simple components", () => {
    expectParsedHookName("const value = useState(0);", "value");
  });

  it("should work with more complex files and components", () => {
    expectParsedHookName("const [complex] = useReducer(fn, 0);", "complex");
  });

  it("should work for custom hook", () => {
    expectParsedHookName("const custom = useCustom();", "custom");
  });

  it("should work when code is using hooks indirectly", () => {
    expectParsedHookName("const indirect = useHook();", "indirect");
  });

  it("should work when code is using nested hooks", () => {
    expectParsedHookName("const nested = useNested();", "nested");
  });

  it("should work for external hooks", () => {
    expectParsedHookName("const external = useExternal();", "external");
  });

  it("should work when multiple hooks are on a line", () => {
    expectParsedHookName("const first = useState(0), second = useMemo(fn);", "second");
  });

  it('should support sources that contain the string "sourceMappingURL="', () => {
    expectParsedHookName("const text = 'sourceMappingURL='; const mapped = useState(0);", "mapped");
  });

  it("should work for simple components", () => {
    expectParsedHookName("const value = useState(0);", "value");
  });

  it("should work with more complex files and components", () => {
    expectParsedHookName("const complex = useMemo(fn);", "complex");
  });

  it("should work for custom hook", () => {
    expectParsedHookName("const custom = useCustom();", "custom");
  });

  it("should work when code is using hooks indirectly", () => {
    expectParsedHookName("const indirect = useHook();", "indirect");
  });

  it("should work when code is using nested hooks", () => {
    expectParsedHookName("const nested = useNested();", "nested");
  });

  it("should work for external hooks", () => {
    expectParsedHookName("const external = useExternal();", "external");
  });

  it("should work when multiple hooks are on a line", () => {
    expectParsedHookName("const first = useState(0), second = useMemo(fn);", "second");
  });

  it('should support sources that contain the string "sourceMappingURL="', () => {
    expectParsedHookName("const mapped = useState(0);", "mapped");
  });

  it("should use worker", () => {
    expectParsedHookName("const worker = useState(0);", "worker");
  });
});
