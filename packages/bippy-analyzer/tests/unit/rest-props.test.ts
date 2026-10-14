import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("rest props", () => {
  const project = analyzeFixture("conformance-repros", "rest-props");

  it("samples the props a rest spread's type requires, to mount with", () => {
    expect(getComponent(project, "PassedField").analysis.wholePropsSample).toEqual({
      kind: "Object",
      fields: {
        name: { kind: "Value", value: "text" },
        render: { kind: "Function", returns: { kind: "Value", value: "text" } },
      },
      isOpen: false,
    });
  });

  it("samples nothing when the type requires no props, like a button's attributes", () => {
    expect(getComponent(project, "PlainButton").analysis.wholePropsSample).toBeNull();
  });
});
