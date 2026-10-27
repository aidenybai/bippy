import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a string state narrowed to a literal", () => {
  const project = analyzeFixture("conformance-repros", "string-length-cases");

  it("bounds its length by the literal", () => {
    const { report } = getComponent(project, "AppendText");
    const conditions = report.states.map((state) => state.conditions);
    expect(conditions).not.toContainEqual(["text.length > 1", 'text === ""']);
    const empty = conditions.findIndex((condition) => condition.includes('text === ""'));
    const long = conditions.findIndex((condition) => condition.includes("text.length > 1"));
    expect(report.states[empty]?.transitions[0]?.targets).toEqual([long]);
  });
});
