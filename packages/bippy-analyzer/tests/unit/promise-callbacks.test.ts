import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("promise callbacks", () => {
  it("lets a fulfilled promise leave the loading state with data", () => {
    const project = analyzeFixture("conformance-repros", "promise-callbacks");
    const { report } = getComponent(project, "StarCount");
    const starsState = report.states.findIndex((state) =>
      state.conditions.some((condition) => condition.includes("stars !== null")),
    );
    const loadingState = report.states.find((state) => state.conditions.includes("isLoading"));
    const mountTargets =
      loadingState?.transitions.flatMap((transition) => transition.targets) ?? [];
    expect(mountTargets).toContain(starsState);
  });
});
