import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("callback indices", () => {
  const project = analyzeFixture("conformance-repros", "callback-indices");
  const getUpdateValues = (name: string): string[] =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );

  it("binds a mapped callback's index instead of leaving it undefined", () => {
    expect(getUpdateValues("FeaturePicker")).toEqual(["index"]);
  });

  it("passes an unknown to every parameter of a callback an opaque call runs", () => {
    expect(getUpdateValues("LastPicked")).not.toContain("undefined");
  });

  it("passes each literal item's index to an iteration callback", () => {
    expect(getUpdateValues("LiteralPicker")).toEqual(["0", "1"]);
  });
});
