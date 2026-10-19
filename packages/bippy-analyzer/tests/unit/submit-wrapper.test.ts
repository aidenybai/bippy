import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a submit wrapper passed to onSubmit", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "submit-wrapper.tsx"),
    "SignIn",
  );

  it("runs the wrapped function as the form's submit handler", () => {
    const submit = analysis.handlers.find(
      (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "form",
    );
    expect(submit?.trigger).toEqual({ kind: "Event", tag: "form", event: "onSubmit" });
    expect(submit?.updates.map((update) => update.binding.name)).toEqual(["status"]);
    expect(analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")).toHaveLength(
      0,
    );
  });

  it("reaches the sent state through the form", () => {
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(0);
    expect(report.states.flatMap((state) => state.transitions)).toHaveLength(1);
  });
});
