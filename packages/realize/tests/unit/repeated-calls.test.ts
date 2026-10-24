import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("repeated calls", () => {
  const project = analyzeFixture("conformance-repros", "repeated-calls");

  it("reads the same non-mutating call on the same values as one value", () => {
    const { analysis, report } = getComponent(project, "ProviderRow");
    expect(
      analysis.bindings.filter((binding) => binding.kind === "call").map((binding) => binding.name),
    ).toEqual(['provider.name.startsWith("Local")', 'provider.tags.includes("beta")']);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['provider.name.startsWith("Local")'],
      ['!provider.name.startsWith("Local")'],
      ['provider.tags.includes("beta")'],
      ['!provider.tags.includes("beta")'],
    ]);
  });
});
