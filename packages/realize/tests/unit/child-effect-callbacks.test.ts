import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a callback prop that a child component calls", () => {
  const project = analyzeFixture("conformance-repros", "child-effect-callbacks");

  const getEffectUpdates = (name: string) =>
    getComponent(project, name)
      .analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")
      .flatMap((handler) => handler.updates.map((update) => update.binding.name));

  it("also runs after a commit when the child can call it from an effect", () => {
    expect(getEffectUpdates("MountedAnnouncer")).toEqual(["count"]);
  });

  it("stays an event when the child only calls it from an event handler", () => {
    expect(getEffectUpdates("MountedPicker")).toEqual([]);
  });
  it("finds the effect in a memo, forwardRef or default-exported child", () => {
    expect(getEffectUpdates("WrappedAnnouncers")).toEqual(["count", "count", "count"]);
  });
});
