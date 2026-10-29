import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("double negation", () => {
  const project = analyzeFixture("conformance-repros", "coerced-flags");

  it("keeps !! on a value that isn't boolean, so the state it sets stays a boolean", () => {
    const { analysis, report } = getComponent(project, "PublishButton");
    const [update] = analysis.handlers.flatMap((handler) => handler.updates);
    expect(update && formatSymbolicValue(update.value)).toBe("!!draftTitle");
    expect(report.claimOutcomes.map(({ verdict }) => verdict)).toEqual(["holds"]);
  });
});
