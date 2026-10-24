import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("asserted state", () => {
  const project = analyzeFixture("conformance-repros", "asserted-state");
  const getStateDomain = (name: string) =>
    getComponent(project, name).analysis.bindings.find((binding) => binding.kind === "state")
      ?.domain;

  it("gives no domain to a state initialized from an untyped value cast to a type", () => {
    expect(getStateDomain("CheckboxCell")).toEqual({ kind: "Unknown", reason: "cast" });
  });

  it("keeps the type of a state initialized from a typed value", () => {
    expect(getStateDomain("ToggleCell")?.kind).toBe("Cases");
  });
});
