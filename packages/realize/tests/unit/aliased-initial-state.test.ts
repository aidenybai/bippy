import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("aliased initial state", () => {
  const project = analyzeFixture("conformance-repros", "aliased-initial-state");

  it("warns when a handler mutates the module value state starts from", () => {
    expect(getComponent(project, "ReversedInbox").analysis.warnings).toMatchObject([
      { kind: "state-mutation", message: "mutates mails in place before setting it" },
    ]);
  });

  it("ignores a mutated module value that state doesn't start from", () => {
    expect(getWarningKinds(getComponent(project, "ReversedArchive"))).toEqual([]);
  });
});
