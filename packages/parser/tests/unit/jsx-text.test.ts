import { describe, expect, it } from "vite-plus/test";
import { cleanJsxText, decodeJsxEntities } from "@bippy/parser";

describe("cleanJsxText", () => {
  it("keeps single-line text including surrounding spaces", () => {
    expect(cleanJsxText(" hello world ")).toBe(" hello world ");
  });

  it("trims lines at newline boundaries and joins them with one space", () => {
    expect(cleanJsxText("\n    Hello,\n    world\n  ")).toBe("Hello, world");
  });

  it("drops text that is only whitespace with a newline", () => {
    expect(cleanJsxText("\n   \n")).toBeNull();
    expect(cleanJsxText("   ")).toBe("   ");
  });

  it("keeps leading space on the first line and trailing space on the last", () => {
    expect(cleanJsxText("  a\n  b  ")).toBe("  a b  ");
  });

  it("turns tabs into spaces and skips blank lines", () => {
    expect(cleanJsxText("\ta\n\n\t\tb\n")).toBe(" a b");
  });

  it("decodes entities before cleaning", () => {
    expect(cleanJsxText("&lt;b&gt;\n  &amp;&nbsp;&copy;")).toBe("<b> &\u00a0©");
  });
});

describe("decodeJsxEntities", () => {
  it("decodes named, decimal and hexadecimal references", () => {
    expect(decodeJsxEntities("&quot;&#39;&#x27;&hellip;")).toBe("\"''…");
  });

  it("leaves unknown or malformed references untouched", () => {
    expect(decodeJsxEntities("&nope; &#xZZ; & &amp")).toBe("&nope; &#xZZ; & &amp");
  });

  it("rejects code points outside the unicode range", () => {
    expect(decodeJsxEntities("&#x110000;")).toBe("&#x110000;");
  });
});
