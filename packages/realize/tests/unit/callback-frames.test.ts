import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a local written in one callback and read in another", () => {
  const project = analyzeFixture("conformance-repros", "callback-frames");

  it("is not read as the other callback's write", () => {
    const { analysis, report } = getComponent(project, "LoadTimeout");
    expect(analysis.handlers.flatMap((handler) => handler.updates)).toHaveLength(1);
    expect(report.states).toHaveLength(2);
  });
});
