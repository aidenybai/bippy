import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("flushSync", () => {
  const project = analyzeFixture("conformance-repros", "flush-sync");

  it("runs its callback now, not as an async call", () => {
    const { analysis } = getComponent(project, "FlushSyncPair");
    const updates = analysis.handlers.flatMap((handler) => handler.updates);
    expect(updates.map((update) => [formatSymbolicValue(update.value), update.isAsync])).toEqual([
      ["count + 1", false],
      ["count + 1", false],
    ]);
  });
});
