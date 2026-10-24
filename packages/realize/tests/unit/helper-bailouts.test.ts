import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { analyzeFixture, getComponent } from "./helpers";

describe("a bailout inside a helper from another file", () => {
  const project = analyzeFixture("conformance-repros", "helper-bailouts");

  it("is reported at the component's call to the helper", () => {
    const { bailouts } = getComponent(project, "SlottedCard").analysis;
    const lines = bailouts.map(({ reason, loc }) => [
      reason,
      loc === GeneratedSource ? null : loc.start.line,
    ]);
    expect(lines).toEqual([["unknown-call", 5]]);
  });
});
