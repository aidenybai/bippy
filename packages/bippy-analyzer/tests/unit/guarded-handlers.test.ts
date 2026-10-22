import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("guarded handlers", () => {
  const project = analyzeFixture("conformance-repros", "guarded-handlers");

  const getAssertion = (name: string, description: string) =>
    getComponent(project, name).report.claimOutcomes.find(
      (outcome) => outcome.claim.description === description,
    );

  it("proves a claim the render condition guards", () => {
    expect(getAssertion("ModalFooter", "modal.onConfirm!")).toMatchObject({ verdict: "holds" });
  });

  it("proves a claim a disabled prop guards", () => {
    expect(getAssertion("SendButton", "draft!")).toMatchObject({ verdict: "holds" });
  });

  it("guards claims in helpers the handler calls", () => {
    expect(getAssertion("ConfirmLink", "modal.onConfirm!")).toMatchObject({ verdict: "holds" });
  });

  it("proves a claim the condition on a mapped element guards", () => {
    expect(getAssertion("MappedConfirms", "modal.onConfirm!")).toMatchObject({ verdict: "holds" });
  });

  it("proves a claim an early return in a map callback guards", () => {
    expect(getAssertion("MappedReturns", "modal.onConfirm!")).toMatchObject({ verdict: "holds" });
  });

  it("breaks a claim when an unguarded element shares the handler", () => {
    expect(getAssertion("SharedConfirm", "modal.onConfirm!")).toMatchObject({
      verdict: "broken",
      reason: "modal.onConfirm = undefined",
    });
  });
});
