import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("computed read inputs", () => {
  it("ties a computed read to the state its key reads", () => {
    const project = analyzeFixture("conformance-repros", "computed-read-inputs");
    const { report } = getComponent(project, "SnippetTabs");
    expect(report.states.every((state) => state.transitions.length > 0)).toBe(true);
  });
});
