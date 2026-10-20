import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

const getSubmitHandler = (analysis: ReturnType<typeof getComponent>["analysis"]) =>
  analysis.handlers.find(
    (handler) => handler.trigger.kind === "Event" && handler.trigger.tag === "form",
  );

describe("a submit wrapper passed to onSubmit", () => {
  const project = analyzeFixture("symbolic-tree", "submit-wrapper.tsx");
  const { analysis, report } = getComponent(project, "SignIn");

  it("runs the wrapped function as the form's submit handler", () => {
    const submit = getSubmitHandler(analysis);
    expect(submit?.trigger).toEqual({ kind: "Event", tag: "form", event: "onSubmit" });
    expect(submit?.updates.map((update) => update.binding.name)).toEqual(["form", "status"]);
    expect(analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")).toHaveLength(
      0,
    );
  });

  it("reaches the sent state through the form", () => {
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(0);
    expect(report.states.flatMap((state) => state.transitions)).toHaveLength(1);
  });

  it("can show the wrapper's validation errors after a submit", () => {
    const subscribe = getComponent(project, "Subscribe");
    const submit = getSubmitHandler(subscribe.analysis);
    const [withError, withoutError] = subscribe.report.states;
    expect(withError?.conditions).toEqual(["useForm().formState.errors.email"]);
    expect(withoutError?.conditions).toEqual(["!useForm().formState.errors.email"]);
    const submitTargets = withoutError?.transitions.find(
      (transition) => transition.handlerId === submit?.id,
    )?.targets;
    expect(submitTargets).toContain(0);
  });
});
