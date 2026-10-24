import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an object rest of typed state", () => {
  const project = analyzeFixture("conformance-repros", "rest-fields");

  it.each(["RestUpdater", "RestHandler"])("%s keeps the fields it did not take", (name) => {
    const { states } = getComponent(project, name).report;
    expect(states.map((state) => state.conditions)).toEqual([
      ["form.status.value > 0"],
      ["form.status.value <= 0"],
    ]);
  });
});
