import { describe, expect, it } from "vite-plus/test";
import { summarizeModule } from "../conformance/verifier/source-index";

describe("module summary", () => {
  it("records a default export under the name a module import sees", () => {
    expect(
      summarizeModule("export default function Panel() {}\nexport const Row = 1;").exports,
    ).toEqual([
      { name: "Panel", exportName: "default" },
      { name: "Row", exportName: "Row" },
    ]);
  });

  it("names the component behind a default export of a binding, a wrapper call or a renamed export", () => {
    const card = { name: "Card", exportName: "default" };
    expect(summarizeModule("const Card = () => null;\nexport default Card;").exports).toEqual([
      card,
    ]);
    expect(summarizeModule("const Card = () => null;\nexport default memo(Card);").exports).toEqual(
      [card],
    );
    expect(
      summarizeModule("const Card = () => null;\nexport { Card as default };").exports,
    ).toEqual([card]);
  });

  it("ignores exports and imports written in comments or strings", () => {
    const summary = summarizeModule(
      "// export const Hidden = 1;\nconst text = \"export function Ghost() {} import x from 'y'\";",
    );
    expect(summary.exports).toEqual([]);
    expect(summary.imports).toEqual([]);
  });

  it("finds the export name of a store created at the top level", () => {
    expect(
      summarizeModule("const store = configureStore({ reducer });\nexport default store;")
        .storeExportName,
    ).toBe("default");
    expect(summarizeModule("export const appStore = createStore(reducer);").storeExportName).toBe(
      "appStore",
    );
    expect(
      summarizeModule("const makeStore = () => configureStore({ reducer });\nexport { makeStore };")
        .storeExportName,
    ).toBeNull();
  });

  it("lists the names each value import uses, and skips type imports", () => {
    expect(
      summarizeModule(
        'import { Inter, type NextFontWithVariable } from "next/font/google";\nimport type { Metadata } from "next";',
      ).imports,
    ).toEqual([{ specifier: "next/font/google", names: ["Inter"] }]);
  });

  it("summarizes a file it can't parse as empty", () => {
    expect(summarizeModule("export const = ;").exports).toEqual([]);
  });
});
