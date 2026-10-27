import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a useOptimistic value", () => {
  const project = analyzeFixture("conformance-repros", "optimistic-pending");

  const getUnreachable = (name: string) =>
    getComponent(project, name).report.unreachableBranches.map((branch) => branch.description);

  it("can show its optimistic update while a transition is pending", () => {
    expect(getUnreachable("PendingOptimistic")).toEqual([]);
  });

  it("follows its passthrough value when nothing sets it", () => {
    const { states } = getComponent(project, "PassthroughOptimistic").report;
    expect(states).toHaveLength(2);
  });
});
