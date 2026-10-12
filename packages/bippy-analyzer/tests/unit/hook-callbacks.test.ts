import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { formatSymbolicValue } from "../../src/core/format.js";
import { getBinding, getComponent, getFixtureConfig } from "./helpers.js";

describe("callbacks passed to hooks", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "hook-callbacks");
  const overlay = getComponent(project, "Overlay");

  it("runs a function passed to a hook it can't see into as an effect", () => {
    const [handler] = overlay.analysis.handlers;
    expect(handler?.trigger.kind).toBe("Effect");
    expect(
      handler?.updates.map((update) => [update.binding.name, formatSymbolicValue(update.value)]),
    ).toEqual([["mounted", "true"]]);
  });

  it("mounts a DOM node prop as unset, since no plain value stands in for one", () => {
    expect(getBinding(overlay, "container").samples).toEqual([
      { kind: "Value", value: null },
      { kind: "Undefined" },
    ]);
  });

  it("runs a function passed to a call it can't see into as an effect, like a submit handler", () => {
    const signUp = getComponent(project, "SignUp");
    expect(signUp.report.unreachableBranches).toEqual([]);
    expect(signUp.report.states).toHaveLength(2);
  });

  it("runs a callback a handler passes on in an options object, like `onSuccess`", () => {
    const form = getComponent(project, "ApiKeyForm");
    expect(form.report.unreachableBranches).toEqual([]);
    expect(form.report.states).toHaveLength(2);
  });

  it("runs a ref callback as a layout effect, since React calls it when it attaches the element", () => {
    const truncated = getComponent(project, "Truncated");
    expect(truncated.report.unreachableBranches).toEqual([]);
    expect(truncated.analysis.handlers.map((handler) => handler.trigger)).toEqual([
      { kind: "Effect", hookKind: "useLayoutEffect", dependencies: null },
    ]);
  });

  it("runs the handlers a function child renders, as a component gets children as a prop", () => {
    expect(getComponent(project, "RegionMap").report.unreachableBranches).toEqual([]);
  });

  it("runs a function a handler stores on an object, which whatever reads it may call", () => {
    expect(getComponent(project, "Dictation").report.unreachableBranches).toEqual([]);
  });

  it("runs the handlers of a component declared inside this one, which set this one's state", () => {
    expect(getComponent(project, "Reactions").report.unreachableBranches).toEqual([]);
  });

  it("doesn't assume a ref is still unset when a handler reads it", () => {
    const [handler] = getComponent(project, "Seeker").analysis.handlers;
    expect(handler?.updates.map((update) => update.binding.name)).toEqual(["time"]);
  });

  it("renders a portal's children where the portal is, with their handlers", () => {
    const toolbar = getComponent(project, "PortalToolbar");
    expect(toolbar.analysis.handlers.map((handler) => handler.trigger)).toEqual([
      { kind: "Event", tag: "button", event: "onClick" },
    ]);
    expect(toolbar.report.states).toHaveLength(2);
  });

  it("doesn't trust the `undefined` type of `useState()` that a handler sets", () => {
    expect(getComponent(project, "Tooltip").report.unreachableBranches).toEqual([]);
  });

  it("calls either function a condition chooses, like one of two setters", () => {
    expect(getComponent(project, "DragPreview").report.unreachableBranches).toEqual([]);
  });

  it("runs a handler's catch block, which sets state when what it tries throws", () => {
    expect(getComponent(project, "TwoFactor").report.unreachableBranches).toEqual([]);
  });

  it("runs the functions of an object handed to a component, like a context's value", () => {
    expect(getComponent(project, "MemoCard").report.unreachableBranches).toEqual([]);
  });

  it("runs the functions of the handle `useImperativeHandle` gives the parent", () => {
    expect(project.components.flatMap((component) => component.report.unreachableBranches)).toEqual(
      [],
    );
  });
});
