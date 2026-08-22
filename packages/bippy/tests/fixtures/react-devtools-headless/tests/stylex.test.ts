import { afterEach, describe, expect, it } from "vite-plus/test";
import { getStyleXData } from "../src/stylex.js";

const styleElements: HTMLStyleElement[] = [];

const defineStyles = (styles: string): void => {
  const styleElement = document.createElement("style");
  styleElement.textContent = styles;
  styleElements.push(styleElement);
  document.head.appendChild(styleElement);
};

afterEach(() => {
  for (const styleElement of styleElements.splice(0)) styleElement.remove();
});

describe("upstream StyleX behavior", () => {
  it("should gracefully handle empty values", () => {
    const empty = { resolvedStyles: {}, sources: [] };
    expect(getStyleXData(null)).toEqual(empty);
    expect(getStyleXData(undefined)).toEqual(empty);
    expect(getStyleXData("")).toEqual(empty);
    expect(getStyleXData([undefined])).toEqual(empty);
  });

  it("should support simple style objects", () => {
    defineStyles(
      ".foo { display: flex; } .bar { align-items: center; } .baz { flex-direction: center; }",
    );
    expect(
      getStyleXData({
        Example__style: "Example__style",
        alignItems: "bar",
        display: "foo",
        flexDirection: "baz",
      }),
    ).toEqual({
      resolvedStyles: { alignItems: "center", display: "flex", flexDirection: "center" },
      sources: ["Example__style"],
    });
  });

  it("should support multiple style objects", () => {
    defineStyles(
      ".foo { display: flex; } .bar { align-items: center; } .baz { flex-direction: center; }",
    );
    expect(
      getStyleXData([
        { Example1__style: "Example1__style", display: "foo" },
        {
          Example2__style: "Example2__style",
          alignItems: "bar",
          flexDirection: "baz",
        },
      ]),
    ).toEqual({
      resolvedStyles: { alignItems: "center", display: "flex", flexDirection: "center" },
      sources: ["Example1__style", "Example2__style"],
    });
  });

  it("should filter empty rules", () => {
    defineStyles(".foo { display: flex; } .bar { align-items: center; }");
    expect(
      getStyleXData([
        false,
        { Example1__style: "Example1__style", display: "foo" },
        false,
        { Example2__style: "Example2__style", alignItems: "bar" },
      ]),
    ).toEqual({
      resolvedStyles: { alignItems: "center", display: "flex" },
      sources: ["Example1__style", "Example2__style"],
    });
  });

  it("should support pseudo-classes", () => {
    defineStyles(".foo { color: black; } .bar { color: blue; } .baz { text-decoration: none; }");
    expect(
      getStyleXData({
        ":hover": { color: "bar", textDecoration: "baz" },
        Example__style: "Example__style",
        color: "foo",
      }),
    ).toEqual({
      resolvedStyles: {
        ":hover": { color: "blue", textDecoration: "none" },
        color: "black",
      },
      sources: ["Example__style"],
    });
  });

  it("should support nested selectors", () => {
    defineStyles(
      ".foo { display: flex; } .bar { align-items: center; } .baz { flex-direction: center; }",
    );
    expect(
      getStyleXData([
        { Example1__style: "Example1__style", display: "foo" },
        false,
        [
          false,
          { Example2__style: "Example2__style", flexDirection: "baz" },
          { Example3__style: "Example3__style", alignItems: "bar" },
        ],
      ]),
    ).toEqual({
      resolvedStyles: { alignItems: "center", display: "flex", flexDirection: "center" },
      sources: ["Example1__style", "Example2__style", "Example3__style"],
    });
  });
});
