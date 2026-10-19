import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("renamed props with defaults", () => {
  const project = analyzeFixture("conformance-repros", "renamed-defaults");

  it.each(["Badge", "Panel"])("reads the declared type of the prop %s renames", (name) => {
    const { analysis, report } = getComponent(project, name);
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(2);
  });

  it("keeps undefined among the values a defaulted prop can hold", () => {
    const tone = getComponent(project, "Badge").analysis.bindings.find(
      (binding) => binding.propName === "tone",
    );
    expect(tone?.domain).toEqual({
      kind: "Cases",
      cases: [
        { kind: "Literal", value: "loud" },
        { kind: "Literal", value: "plain" },
        { kind: "Literal", value: undefined },
      ],
      origin: "type",
    });
  });
});
