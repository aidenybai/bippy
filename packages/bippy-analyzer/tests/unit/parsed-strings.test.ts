import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("samples of parsed strings", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "parsed-strings");
  const receipt = getComponent(project, "Receipt");

  it("mounts a string a name marks as a date with a date", () => {
    expect(getBinding(receipt, "createdAt").samples[0]).toEqual({
      kind: "Value",
      value: "2024-01-01T00:00:00.000Z",
    });
  });

  it("mounts a Date with a Date", () => {
    expect(getBinding(receipt, "paidOn").samples).toEqual([
      { kind: "Date", value: "2024-01-01T00:00:00.000Z" },
    ]);
  });

  it("mounts a field a name marks as a currency code with a currency code", () => {
    expect(getBinding(receipt, "price").samples[0]).toEqual({
      kind: "Object",
      fields: {
        amount: { kind: "Value", value: "text" },
        currencyCode: { kind: "Value", value: "USD" },
      },
      isOpen: false,
    });
  });

  it("mounts an untyped value a name marks as a date with a date", () => {
    expect(getBinding(getComponent(project, "DateLabel"), "endDate").samples).toEqual([
      { kind: "Value", value: "2024-01-01T00:00:00.000Z" },
    ]);
  });

  it("mounts a string named as a locale with a locale", () => {
    expect(getBinding(getComponent(project, "Greeting"), "locale").samples[0]).toEqual({
      kind: "Value",
      value: "en",
    });
  });

  it("mounts a string named as a color with a color", () => {
    expect(getBinding(getComponent(project, "Swatch"), "primaryColor").samples[0]).toEqual({
      kind: "Value",
      value: "#808080",
    });
  });

  it("mounts an array of nodes with an array, not a node", () => {
    expect(getBinding(getComponent(project, "Toolbar"), "actions").samples).toEqual([
      { kind: "Array", items: [] },
      { kind: "Array", items: [{ kind: "Value", value: "text" }] },
    ]);
  });

  it("mounts a Set with a Set", () => {
    expect(getBinding(getComponent(project, "NamespaceFilter"), "namespaces").samples).toEqual([
      { kind: "Set", items: [{ kind: "Value", value: "text" }] },
    ]);
  });

  it("mounts a Map behind an alias with a Map", () => {
    expect(getBinding(getComponent(project, "CachedIcon"), "cache").samples).toEqual([
      {
        kind: "Map",
        entries: [
          [
            { kind: "Value", value: "text" },
            { kind: "Value", value: "text" },
          ],
        ],
      },
    ]);
  });

  it("recognizes a library type by its declaration, even under an alias", () => {
    const aliased = getComponent(project, "AliasedTypes");
    expect(getBinding(aliased, "when").samples[0]?.kind).toBe("Date");
    expect(getBinding(aliased, "icon").samples[0]?.kind).toBe("Element");
  });
});
