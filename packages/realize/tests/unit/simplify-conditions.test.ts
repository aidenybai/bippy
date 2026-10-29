import { describe, expect, it } from "vite-plus/test";
import { simplifyConditions } from "../../src/cli/simplify-conditions";

describe("simplifyConditions", () => {
  it("drops the inequalities an equality on the same place implies", () => {
    expect(simplifyConditions(["step !== 0", "step !== 1", "step === 2"])).toEqual(["step === 2"]);
  });

  it("joins the inequalities of an undecided place into one exclusion", () => {
    expect(simplifyConditions(["isOpen", "step !== 0", "step !== 1", "step !== 2"])).toEqual([
      "isOpen",
      "step ∉ {0, 1, 2}",
    ]);
  });

  it("keeps a lone inequality and conditions on other places", () => {
    expect(simplifyConditions(["step !== 0", "!isOpen", 'mode === "edit"'])).toEqual([
      "step !== 0",
      "!isOpen",
      'mode === "edit"',
    ]);
  });
});
