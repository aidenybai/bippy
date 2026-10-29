import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a memo whose dependency is an optional chain", () => {
  const project = analyzeFixture("conformance-repros", "optional-chain-deps");

  it("is not stale for reading the chain's base", () => {
    const { states } = getComponent(project, "OptionalDependency").report;
    expect(states.map((state) => state.conditions)).toEqual([
      ["renderHeader != null && snapshot?.header != null"],
      ["!(renderHeader != null && snapshot?.header != null)"],
    ]);
  });

  it("is not stale for the items of an array it depends on", () => {
    const { render } = getComponent(project, "MappedChain").analysis;
    expect(JSON.stringify(render)).not.toContain('"reason":"memo"');
  });

  it("is still stale for a field its dependencies leave out", () => {
    const { render } = getComponent(project, "StaleSibling").analysis;
    expect(render).toMatchObject({
      children: [{ kind: "Binding", binding: { kind: "call", hookKind: "useMemo" } }],
    });
  });
});
