import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("transition callbacks", () => {
  const project = analyzeFixture("conformance-repros", "transition-callbacks");

  const getHandler = (name: string) => {
    const [handler] = getComponent(project, name).analysis.handlers;
    return {
      delegates: handler?.delegates,
      updates: handler?.updates.map((update) => [
        update.binding.name,
        update.isAsync,
        update.value,
      ]),
    };
  };

  it("runs the scope a hook's startTransition receives in place", () => {
    expect(getHandler("HookTransition")).toEqual({
      delegates: [],
      updates: [["selected", false, { kind: "Primitive", value: "a" }]],
    });
  });

  it("runs the scope React's startTransition receives in place", () => {
    expect(getHandler("StandaloneTransition")).toEqual({
      delegates: [],
      updates: [["selected", false, { kind: "Primitive", value: "a" }]],
    });
  });

  it("leaves other React values alone", () => {
    expect(getHandler("RefTransition")).toEqual({
      delegates: [],
      updates: [["selected", false, { kind: "Primitive", value: "b" }]],
    });
  });
});
