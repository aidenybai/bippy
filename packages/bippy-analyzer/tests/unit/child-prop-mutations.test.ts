import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("child prop mutations", () => {
  const project = analyzeFixture("conformance-repros", "child-prop-mutations");

  const getWarnings = (name: string) =>
    getComponent(project, name).analysis.warnings.map(({ kind, message }) => ({ kind, message }));

  it("warns in the child that mutates its prop", () => {
    expect(getWarnings("HeaderList")).toEqual([
      { kind: "prop-mutation", message: "mutates prop headers" },
    ]);
  });

  it("charges the parent's state the child mutates", () => {
    expect(getWarnings("WebhookForm")).toEqual([
      { kind: "state-mutation", message: "mutates form.headers through HeaderList" },
    ]);
  });

  it("passes a prop mutation up through a parent that forwards the prop", () => {
    expect(getWarnings("HeaderSection")).toEqual([
      { kind: "prop-mutation", message: "mutates prop headers through HeaderList" },
    ]);
  });
});
