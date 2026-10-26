import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("module state imported from another project file", () => {
  const project = analyzeFixture("conformance-repros", "imported-module-state");

  it.each(["ImportedQueue", "ImportedTotal", "ImportedSession"])(
    "lets %s's next render show the change",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.regions[0]?.firstRenderState).toBe(0);
      expect(report.states[0]?.transitions.flatMap((transition) => transition.targets)).toContain(
        1,
      );
    },
  );
});
