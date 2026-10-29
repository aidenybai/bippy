import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("calling a step that an opaque array method reads from a table", () => {
  const project = analyzeFixture("conformance-repros", "opaque-table-calls");

  it.each([
    "ReducedCall",
    "SlicedLoop",
    "EntriesLoop",
    "MemoMappedCall",
    "SpreadTableCall",
    "LoopedRowCall",
    "MemoLoopedRowCall",
    "ComputedFieldCall",
    "EntriesTableCall",
    "LoopAfterItemCall",
  ])("%s reaches every step", (name) => {
    expect(getComponent(project, name).report.states).toHaveLength(3);
  });
});
