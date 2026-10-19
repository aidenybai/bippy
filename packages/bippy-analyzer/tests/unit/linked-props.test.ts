import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture } from "./helpers";

describe("props linked from a parent", () => {
  const project = analyzeFixture("symbolic-tree", "linked.tsx");
  const find = (name: string) =>
    project.components.find((component) => component.analysis.name === name);
  const loader = find("Loader");
  const badge = find("StatusBadge");

  it("records the link with the parent's possible values", () => {
    expect(loader?.links).toHaveLength(1);
    const [link] = loader?.links ?? [];
    expect(link?.child).toBe(badge?.analysis.declaration);
    expect(link?.isComplete).toBe(true);
    const status = link?.props.find((prop) => prop.name === "status");
    expect(status?.domain).toEqual({
      kind: "Cases",
      cases: [
        { kind: "Literal", value: "idle" },
        { kind: "Literal", value: "loading" },
        { kind: "Literal", value: "done" },
      ],
      origin: "call-sites",
    });
    expect(link?.props.find((prop) => prop.name === "count")?.domain).toMatchObject({
      kind: "Opaque",
    });
  });

  it("keeps the child's own states from its type", () => {
    expect(badge?.report.states).toHaveLength(4);
    expect(badge?.report.unreachableBranches).toHaveLength(0);
  });

  it("narrows the child's states to what the parent can pass", () => {
    expect(badge?.instances).toHaveLength(3);
    const [instance] = badge?.instances ?? [];
    expect(instance?.link).toBe(loader?.links[0]);
    expect(instance?.report.states).toHaveLength(3);
    expect(instance?.report.unreachableBranches.map((branch) => branch.description)).toEqual([
      expect.stringContaining('status === "error"'),
    ]);
  });

  it("shares one instance between links that pass the same values", () => {
    const gallery = find("Gallery");
    const [, first, second] = badge?.instances ?? [];
    expect(first?.link).toBe(gallery?.links[0]);
    expect(second?.link).toBe(gallery?.links[1]);
    expect(first?.report).toBe(second?.report);
    expect(first?.report.states).toHaveLength(1);
  });
});
