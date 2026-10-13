import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("shapes of untyped props", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "untyped-shapes");
  const row = getComponent(project, "BookingRow");

  it("mounts an untyped prop with the fields the component reads from it", () => {
    expect(getBinding(row, "booking").samples[0]).toEqual({
      kind: "Object",
      fields: {
        guests: {
          kind: "Object",
          fields: { fullName: { kind: "Value", value: "text" } },
          isOpen: false,
        },
        status: { kind: "Value", value: "text" },
        startDate: { kind: "Value", value: "2024-01-01T00:00:00.000Z" },
      },
      isOpen: false,
    });
  });

  it("mounts an untyped prop the component calls an array method on with an array", () => {
    expect(getBinding(row, "stays").samples[0]).toEqual({ kind: "Array", items: [] });
  });

  it("mounts an untyped prop read only with members strings share with arrays as a string", () => {
    expect(getBinding(getComponent(project, "Excerpt"), "title").samples[0]).toEqual({
      kind: "Value",
      value: "text",
    });
  });

  it("mounts an untyped prop the component reads `props` of with an element", () => {
    expect(getBinding(getComponent(project, "FormRow"), "children").samples[0]).toEqual({
      kind: "Element",
    });
  });
});
