import { describe, expect, it } from "vite-plus/test";
import type { Observation } from "../conformance/verifier/driver";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, createCapture, getComponent, getHandlerProbeId } from "./helpers";

const element = (tag: string, children: Shape[]): Shape => ({ kind: "element", tag, children });

const text = (value: string): Shape => ({ kind: "text", text: value });

const capture = (error: string | null, handlerHits: string[] = []): Capture =>
  createCapture({
    handlerHits,
    shapes: [
      element("div", [
        element("button", [text("Sign out")]),
        element("button", [text("All")]),
        ...(error ? [element("p", [text(error)])] : []),
        element("span", [text("all")]),
      ]),
    ],
  });

const click = (label: string): Action => ({
  key: `click:button:${label}`,
  kind: "click",
  tag: "button",
  label,
  isInChild: false,
});

describe("late async updates", () => {
  it("accepts an async update from an earlier action landing on a later edge", () => {
    const project = analyzeFixture("conformance-repros", "late-async-update");
    const component = getComponent(project, "SignOutPanel");
    const { analysis, report } = component;
    const signOut = click("Sign out");
    const showAll = click("All");
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: capture(null) },
      {
        props: {},
        path: [signOut.key],
        action: signOut,
        before: capture(null),
        after: capture(null, [getHandlerProbeId(component, "async () =>")]),
      },
      {
        props: {},
        path: [signOut.key, showAll.key],
        action: showAll,
        before: capture(null),
        after: capture("Sign out failed", [getHandlerProbeId(component, '() => setTab("all")')]),
      },
    ];
    const verdict = scoreComponent(analysis, report, observations, new Map());
    expect(verdict.transitionCounterexamples).toEqual([]);
  });

  it("still rejects the update when no earlier action could have caused it", () => {
    const project = analyzeFixture("conformance-repros", "late-async-update");
    const component = getComponent(project, "SignOutPanel");
    const { analysis, report } = component;
    const showAll = click("All");
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: capture(null) },
      {
        props: {},
        path: [showAll.key],
        action: showAll,
        before: capture(null),
        after: capture("Sign out failed", [getHandlerProbeId(component, '() => setTab("all")')]),
      },
    ];
    const verdict = scoreComponent(analysis, report, observations, new Map());
    expect(verdict.transitionCounterexamples).toHaveLength(1);
  });
});
