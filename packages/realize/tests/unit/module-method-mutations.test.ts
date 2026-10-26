import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("module and ref values changed in a handler", () => {
  const project = analyzeFixture("conformance-repros", "module-method-mutations");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it.each(["PushedLog", "SeenSet", "HelperClicks", "RefLog"])(
    "lets %s's next render show the change",
    (name) => {
      const { report } = getComponent(project, name);
      const firstState = report.regions[0]?.firstRenderState ?? -1;
      const targets = getTargets(name)[firstState]?.flat() ?? [];
      expect(targets.some((target) => target !== firstState)).toBe(true);
    },
  );
});
