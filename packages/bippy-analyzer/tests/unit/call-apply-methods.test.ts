import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("call and apply on a function", () => {
  const project = analyzeFixture("conformance-repros", "call-apply-methods");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [update.binding.name, update.value]),
    );

  it("runs the function through call", () => {
    expect(getUpdates("PlainCall")).toEqual([["left", { kind: "Primitive", value: 1 }]]);
  });

  it("runs the function through apply with the literal arguments", () => {
    expect(getUpdates("PlainApply")).toEqual([["pick", { kind: "Primitive", value: "b" }]]);
  });

  it("runs both arms of a conditional receiver", () => {
    expect(getUpdates("ChosenCall").map(([name]) => name)).toEqual(["isLeft", "left", "right"]);
  });
});
