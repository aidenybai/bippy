import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("writes through a ref received as a prop", () => {
  const project = analyzeFixture("symbolic-tree", "ref-props.tsx");

  it("are not prop mutations when the prop is a ref", () => {
    expect(getComponent(project, "Latest").analysis.warnings).toEqual([]);
    expect(getComponent(project, "Seen").analysis.warnings).toEqual([]);
  });

  it("still warn on a plain object with a current field", () => {
    expect(getComponent(project, "Box").analysis.warnings.map((warning) => warning.kind)).toEqual([
      "prop-mutation",
    ]);
  });
});
