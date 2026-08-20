import { createElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  extractLocationFromComponentStack,
  formatConsoleArguments,
  formatConsoleArgumentsToSingleString,
  formatWithStyles,
  getDisplayName,
  getDisplayNameForReactElement,
  gt,
  gte,
  isPlainObject,
  printOperationsArray,
  stackToComponentLocations,
} from "../src/shared-utils.js";
import { symbolicateSource } from "../src/symbolicate-source.js";

describe("upstream shared utility behavior", () => {
  describe("getDisplayName", () => {
    it("should return a function name", () => {
      const FauxComponent = () => null;
      expect(getDisplayName(FauxComponent)).toBe("FauxComponent");
    });

    it("should return a displayName name if specified", () => {
      const FauxComponent = () => null;
      Reflect.set(FauxComponent, "displayName", "OverrideDisplayName");
      expect(getDisplayName(FauxComponent)).toBe("OverrideDisplayName");
    });

    it("should return the fallback for anonymous functions", () => {
      expect(getDisplayName(() => null, "Fallback")).toBe("Fallback");
    });

    it("should return Anonymous for anonymous functions without a fallback", () => {
      expect(getDisplayName(() => null)).toBe("Anonymous");
    });

    it("should return a fallback when the name prop is not a string", () => {
      expect(getDisplayName({ name: {} }, "Fallback")).toBe("Fallback");
    });

    it("should parse a component stack trace", () => {
      expect(
        stackToComponentLocations(`
    at Foobar (http://localhost:3000/static/js/bundle.js:103:74)
    at a
    at header
    at div
    at App`),
      ).toEqual([
        ["Foobar", ["Foobar", "http://localhost:3000/static/js/bundle.js", 103, 74]],
        ["a", null],
        ["header", null],
        ["div", null],
        ["App", null],
      ]);
    });
  });

  describe("getDisplayNameForReactElement", () => {
    const createElementWithType = (elementType?: unknown) =>
      Reflect.apply(createElement, undefined, [elementType, null]);

    it("should return correct display name for an element with function type", () => {
      const FauxComponent = () => null;
      Reflect.set(FauxComponent, "displayName", "OverrideDisplayName");
      expect(getDisplayNameForReactElement(createElement(FauxComponent))).toBe(
        "OverrideDisplayName",
      );
    });

    it("should return correct display name for an element with a type of StrictMode", () => {
      expect(
        getDisplayNameForReactElement(createElementWithType(Symbol.for("react.strict_mode"))),
      ).toBe("StrictMode");
    });

    it("should return correct display name for an element with a type of SuspenseList", () => {
      expect(
        getDisplayNameForReactElement(createElementWithType(Symbol.for("react.suspense_list"))),
      ).toBe("SuspenseList");
    });

    it("should return NotImplementedInDevtools for an element with invalid symbol type", () => {
      expect(getDisplayNameForReactElement(createElementWithType(Symbol("foo")))).toBe(
        "NotImplementedInDevtools",
      );
    });

    it("should return NotImplementedInDevtools for an element with invalid type", () => {
      expect(getDisplayNameForReactElement(createElementWithType(true))).toBe(
        "NotImplementedInDevtools",
      );
    });

    it("should return Element for null type", () => {
      expect(getDisplayNameForReactElement(createElementWithType())).toBe("Element");
    });
  });

  describe("formatConsoleArgumentsToSingleString", () => {
    it("should format simple strings", () => {
      expect(formatConsoleArgumentsToSingleString("a", "b", "c")).toBe("a b c");
    });

    it("should format multiple argument types", () => {
      expect(formatConsoleArgumentsToSingleString("abc", 123, true)).toBe("abc 123 true");
    });

    it("should support string substitutions", () => {
      expect(formatConsoleArgumentsToSingleString("a %s b %s c", 123, true)).toBe("a 123 b true c");
    });

    it("should support integer substitutions", () => {
      expect(formatConsoleArgumentsToSingleString("%i", 3.14)).toBe("3");
    });

    it("should support float substitutions", () => {
      expect(formatConsoleArgumentsToSingleString("%f", 3.5)).toBe("3.5");
    });

    it("should keep argument alignment across mixed substitutions", () => {
      expect(formatConsoleArgumentsToSingleString("a %i b %s", 7, "x")).toBe("a 7 b x");
    });

    it("should gracefully handle Symbol types", () => {
      expect(formatConsoleArgumentsToSingleString(Symbol("a"), "b", Symbol("c"))).toBe(
        "Symbol(a) b Symbol(c)",
      );
    });

    it("should gracefully handle Symbol type for the first argument", () => {
      expect(formatConsoleArgumentsToSingleString(Symbol("abc"), 123)).toBe("Symbol(abc) 123");
    });

    it("should gracefully handle objects with no prototype", () => {
      expect(formatConsoleArgumentsToSingleString("%o", Object.create(null))).toBe(
        "%o [object Object]",
      );
    });
  });

  describe("formatWithStyles", () => {
    it("should format empty arrays", () => {
      expect(formatWithStyles([])).toEqual([]);
      expect(formatWithStyles([], "gray")).toEqual([]);
      expect(formatWithStyles(undefined)).toBeUndefined();
    });

    it("should bail out of strings with styles", () => {
      expect(formatWithStyles(["%ca", "color: green", "b", "c"], "color: gray")).toEqual([
        "%ca",
        "color: green",
        "b",
        "c",
      ]);
    });

    it("should format simple strings", () => {
      expect(formatWithStyles(["a"])).toEqual(["a"]);
      expect(formatWithStyles(["a", "b", "c"], "color: gray")).toEqual([
        "%c%s %s %s",
        "color: gray",
        "a",
        "b",
        "c",
      ]);
    });

    it("should format string substituions", () => {
      expect(formatWithStyles(["%s %s %s", "a", "b", "c"], "color: gray")).toEqual([
        "%c%s %s %s",
        "color: gray",
        "a",
        "b",
        "c",
      ]);
      expect(formatWithStyles(["%s %s", "a", "b", "c"], "color: gray")).toEqual([
        "%c%s %s",
        "color: gray",
        "a",
        "b",
        "c",
      ]);
    });

    it("should support multiple argument types", () => {
      const symbol = Symbol("a");
      expect(
        formatWithStyles(["abc", 123, 12.3, true, { hello: "world" }, symbol], "color: gray"),
      ).toEqual([
        "%c%s %i %f %s %o %s",
        "color: gray",
        "abc",
        123,
        12.3,
        true,
        { hello: "world" },
        symbol,
      ]);
    });

    it("should properly format escaped string substituions", () => {
      expect(formatWithStyles(["%%s"], "color: gray")).toEqual(["%c%s", "color: gray", "%%s"]);
      expect(formatWithStyles(["%%c"], "color: gray")).toEqual(["%c%s", "color: gray", "%%c"]);
      expect(formatWithStyles(["%%c%c"], "color: gray")).toEqual(["%%c%c"]);
    });

    it("should format non string inputs as the first argument", () => {
      expect(formatWithStyles([{ foo: "bar" }], "color: gray")).toEqual([
        "%c%o",
        "color: gray",
        { foo: "bar" },
      ]);
      expect(formatWithStyles([[1, 2, 3], "hi"], "color: gray")).toEqual([
        "%c%o %s",
        "color: gray",
        [1, 2, 3],
        "hi",
      ]);
    });
  });

  describe("semver comparisons", () => {
    it("gte should compare versions correctly", () => {
      expect(gte("1.2.3", "1.2.1")).toBe(true);
      expect(gte("1.2.1", "1.2.1")).toBe(true);
      expect(gte("1.2.1", "1.2.2")).toBe(false);
      expect(gte("10.0.0", "9.0.0")).toBe(true);
    });

    it("gt should compare versions correctly", () => {
      expect(gt("1.2.3", "1.2.1")).toBe(true);
      expect(gt("1.2.1", "1.2.1")).toBe(false);
      expect(gt("1.2.1", "1.2.2")).toBe(false);
      expect(gt("10.0.0", "9.0.0")).toBe(true);
    });
  });

  describe("isPlainObject", () => {
    it("should return true for plain objects", () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ value: 1 })).toBe(true);
      expect(isPlainObject({ nested: { value: 1 } })).toBe(true);
    });

    it("should return false if object is a class instance", () => {
      class Instance {}
      expect(isPlainObject(new Instance())).toBe(false);
    });

    it("should return false for objects, which have not only Object in its prototype chain", () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(Symbol())).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(isPlainObject(5)).toBe(false);
      expect(isPlainObject(true)).toBe(false);
    });

    it("should return true for objects with no prototype", () => {
      expect(isPlainObject(Object.create(null))).toBe(true);
    });
  });

  describe("extractLocationFromComponentStack", () => {
    it("should return null if passed empty string", () => {
      expect(extractLocationFromComponentStack("")).toBeNull();
    });

    it("should construct the source from the first frame if available", () => {
      expect(
        extractLocationFromComponentStack(
          "at l (https://react.dev/main.js:1:10389)\nat f (https://react.dev/app.js:1:8519)",
        ),
      ).toEqual(["l", "https://react.dev/main.js", 1, 10389]);
    });

    it("should construct the source from highest available frame", () => {
      expect(
        extractLocationFromComponentStack(
          "    at Q\n    at a\n    at m (https://react.dev/chunk.js:5:9236)\n    at div",
        ),
      ).toEqual(["m", "https://react.dev/chunk.js", 5, 9236]);
    });

    it("should construct the source from frame, which has only url specified", () => {
      expect(
        extractLocationFromComponentStack("    at Q\n    at https://react.dev/chunk.js:5:9236\n"),
      ).toEqual(["", "https://react.dev/chunk.js", 5, 9236]);
    });

    it("should parse sourceURL correctly if it includes parentheses", () => {
      expect(
        extractLocationFromComponentStack(
          "at HotReload (webpack-internal:///(app-pages-browser)/hot-reloader.js:307:11)",
        ),
      ).toEqual(["HotReload", "webpack-internal:///(app-pages-browser)/hot-reloader.js", 307, 11]);
    });

    it("should support Firefox stack", () => {
      expect(extractLocationFromComponentStack("tt@https://react.dev/chunk.js:1:165558")).toEqual([
        "tt",
        "https://react.dev/chunk.js",
        1,
        165558,
      ]);
    });
  });

  describe("symbolicateSource", () => {
    const prefix = `"use strict";\nfunction f() {}\n//# sourceMappingURL=`;
    const sourceMap =
      '{"version":3,"file":"a.mjs","sourceRoot":"","sources":["a.mts"],"names":[],"mappings":";;AAAA,cAAsB;AAAtB,SAAgB,CAAC,KAAI,CAAC"}';
    const files = new Map([
      ["http://test/a.mts", "export function f() {}"],
      ["http://test/a.mjs.map", sourceMap],
      ["http://test/a.mjs", `${prefix}a.mjs.map`],
      ["http://test/b.mjs", `${prefix}./a.mjs.map`],
      ["http://test/c.mjs", `${prefix}http://test/a.mjs.map`],
      ["http://test/d.mjs", `${prefix}/a.mjs.map`],
    ]);
    const fetchFile = async (url: string) => files.get(url) ?? null;

    it("should parse source map urls", async () => {
      const expected = { ignored: false, location: ["", "http://test/a.mts", 1, 17] };
      for (const url of ["a.mjs", "b.mjs", "c.mjs", "d.mjs"]) {
        await expect(symbolicateSource(fetchFile, `http://test/${url}`, 4, 10)).resolves.toEqual(
          expected,
        );
      }
    });

    it("should not throw for invalid base URL with relative source map", async () => {
      const fetchInvalid = async (url: string) =>
        url === "bundle.js" ? `${prefix}bundle.js.map` : null;
      await expect(symbolicateSource(fetchInvalid, "bundle.js", 1, 1)).resolves.toBeNull();
    });

    it("should resolve absolute source map even if base URL is invalid", async () => {
      const invalidFiles = new Map([
        ["invalid-base.js", `${prefix}http://test/a.mjs.map`],
        ["http://test/a.mjs.map", sourceMap],
      ]);
      const fetchInvalid = async (url: string) => invalidFiles.get(url) ?? null;
      await expect(symbolicateSource(fetchInvalid, "invalid-base.js", 4, 10)).resolves.toEqual({
        ignored: false,
        location: ["", "http://test/a.mts", 1, 17],
      });
    });
  });

  describe("formatConsoleArguments", () => {
    it("works with empty arguments list", () => {
      expect(formatConsoleArguments()).toEqual([]);
    });

    it("works for string without escape sequences", () => {
      expect(formatConsoleArguments("This is the template", "And another string")).toEqual([
        "This is the template",
        "And another string",
      ]);
    });

    it("works with strings templates", () => {
      expect(formatConsoleArguments("This is %s template", "the")).toEqual([
        "This is the template",
      ]);
    });

    it("skips %%s", () => {
      expect(formatConsoleArguments("This %%s is %s template", "the")).toEqual([
        "This %%s is the template",
      ]);
    });

    it("works with %%%s", () => {
      expect(formatConsoleArguments("This %%%s is %s template", "test", "the")).toEqual([
        "This %%test is the template",
      ]);
    });

    it("doesn't inline objects", () => {
      expect(formatConsoleArguments("This is %s template with object %o", "the", {})).toEqual([
        "This is the template with object %o",
        {},
      ]);
    });

    it("doesn't inline css", () => {
      expect(
        formatConsoleArguments("This is template with %c %s object %o", "color: red", "the", {}),
      ).toEqual(["This is template with %c the object %o", "color: red", {}]);
    });

    it("formats nullish values", () => {
      expect(formatConsoleArguments("This is the %s template", null)).toEqual([
        "This is the null template",
      ]);
      expect(formatConsoleArguments("This is the %s template", undefined)).toEqual([
        "This is the undefined template",
      ]);
    });

    it("keeps a trailing percent sign", () => {
      expect(formatConsoleArguments("Progress 100%", "extra")).toEqual(["Progress 100%", "extra"]);
      expect(formatConsoleArguments("%s 100%", "done")).toEqual(["done 100%"]);
    });

    it("keeps specifiers literal when no argument is supplied", () => {
      expect(formatConsoleArguments("%s %s", "the")).toEqual(["the %s"]);
      expect(formatConsoleArguments("%s %d", "value")).toEqual(["value %d"]);
      expect(formatConsoleArguments("%s %i", "value")).toEqual(["value %i"]);
      expect(formatConsoleArguments("%s %f", "value")).toEqual(["value %f"]);
    });
  });

  it("should log an applied activity slice change and advance past its value", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => printOperationsArray([1, 1, 0, 13, 42, 13, 0])).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain("Applied activity slice change to 42");
    expect(log.mock.calls[0]?.[0]).toContain("Reset applied activity slice");
    log.mockRestore();
  });
});
