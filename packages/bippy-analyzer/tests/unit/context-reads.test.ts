import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("context reads after an await", () => {
  const project = analyzeFixture("conformance-repros", "context-reads");

  const getGuards = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [
        update.binding.name,
        update.isAsync,
        update.guards.map(formatSymbolicValue),
      ]),
    );

  it("keeps a flag the cleanup can flip open after an await", () => {
    expect(getGuards("MountedFlag")).toEqual([["value", true, ["Unknown(async)"]]]);
  });

  it("keeps a flag the cleanup can flip open in a then callback", () => {
    expect(getGuards("IgnoreFlag")).toEqual([
      ["name", true, ["!Unknown(rejected)", "!Unknown(async)"]],
    ]);
  });

  it("reads a flag the same async step set", () => {
    expect(getGuards("SettledFlag")).toEqual([["value", true, ["true"]]]);
  });
});
