import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function kept in state", () => {
  const project = analyzeFixture("conformance-repros", "stored-closures");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state) =>
      state.transitions.flatMap((transition) =>
        transition.targets.map((target) => [
          state.conditions.join(" && "),
          states[target]?.conditions.join(" && "),
        ]),
      ),
    );
  };

  it("runs with the values of the render that created it", () => {
    expect(getEdges("LazyStoredAction")).toContainEqual(["!flag && count !== 1", "flag"]);
  });

  it("runs a closure the render stored in a ref", () => {
    expect(getEdges("RenderStoredRef")).toContainEqual([
      "count !== 1 && count === 2",
      "count === 1",
    ]);
  });

  it("keeps running the initial function once a handler can replace it", () => {
    expect(getEdges("ReplacedInitial")).toContainEqual(["items.length <= 1", "items.length > 1"]);
  });

  it("runs one stored function, not each in turn", () => {
    expect(getEdges("RefThenUpdater")).toContainEqual([
      "count !== 1 && count === 2",
      "count !== 1 && count !== 2",
    ]);
  });

  it("runs its updates when it is the handler", () => {
    expect(getEdges("StoredOnClick")).toContainEqual(["count !== 1", "count === 1"]);
  });
});
