import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a string state that several handlers append to", () => {
  const project = analyzeFixture("conformance-repros", "string-appenders");

  it("widens to its type instead of listing every string it can build", () => {
    const { states, regions } = getComponent(project, "PinPad").report;
    expect(states.map((state) => state.conditions)).toEqual([
      ["pin.length >= 4"],
      ["pin.length < 4"],
    ]);
    expect(regions.map((region) => region.firstRenderState)).toEqual([1]);
  });
});
