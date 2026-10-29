import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a class component", () => {
  const project = analyzeFixture("conformance-repros", "class-components");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("is analyzed as a function component when it only uses state, props and methods", () => {
    const bailouts = project.components
      .filter((component) => component.analysis.file.endsWith("class-components.tsx"))
      .filter((component) => component.analysis.bailouts.length > 0)
      .map((component) => component.analysis.name);
    expect(bailouts).toEqual(["ClassAfterUpdate", "ClassForced", "ClassDelayed", "ClassUnbound"]);
  });

  it("reads props through this.props", () => {
    expect(
      getComponent(project, "ClassBadge").analysis.bindings.map((binding) => binding.kind),
    ).toEqual(["prop"]);
  });

  it("toggles state through a class property method", () => {
    expect(getConditions("ClassSwitch")).toEqual([["state.isOn"], ["!state.isOn"]]);
    expect(getComponent(project, "ClassSwitch").report.regions[0]?.firstRenderState).toBe(1);
    expect(getTargets("ClassSwitch")).toEqual([[[1]], [[0]]]);
  });

  it("applies queued updaters from a bound method like the function form", () => {
    expect(getConditions("ClassStepper")).toEqual([["state.step === 0"], ["state.step !== 0"]]);
    expect(getTargets("ClassStepper")).toEqual(getTargets("FunctionStepper"));
  });

  it("keeps the previous state when an updater returns null", () => {
    const conditions = getConditions("ClassCappedCounter").flat();
    expect(conditions.some((condition) => condition.includes("items"))).toBe(false);
  });

  it("runs componentDidMount in the layout phase, before the first paint", () => {
    expect(getConditions("ClassReady")).toEqual([["state.isReady"], ["!state.isReady"]]);
    const { handlers } = getComponent(project, "ClassReady").analysis;
    expect(handlers.map((handler) => handler.trigger)).toMatchObject([
      { kind: "Effect", hookKind: "useLayoutEffect", dependencies: "[]" },
    ]);
  });

  it("lowers a method bound inline or passed unbound without reading this", () => {
    expect(getConditions("ClassInlineBound")).toEqual([["state.isOn"], ["!state.isOn"]]);
    expect(getConditions("ClassUnboundWithoutThis")).toEqual([["state.isOn"], ["!state.isOn"]]);
  });

  it("keeps the bailout for other lifecycles, instance methods, deferred state reads and unbound methods", () => {
    for (const name of ["ClassAfterUpdate", "ClassForced", "ClassDelayed", "ClassUnbound"])
      expect(
        getComponent(project, name).analysis.bailouts.map((bailout) => bailout.reason),
      ).toEqual(["class-component"]);
  });

  it("keeps the export name of an exported class declaration", () => {
    expect(getComponent(project, "ClassCounter").analysis.exportName).toBe("ClassCounter");
  });
});
