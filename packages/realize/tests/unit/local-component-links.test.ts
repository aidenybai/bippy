import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a component defined in the render body", () => {
  const project = analyzeFixture("conformance-repros", "local-component-links");

  it("links the children it renders to the parent", () => {
    expect(getComponent(project, "WebhookSettings").analysis.warnings).toMatchObject([
      { kind: "state-mutation", message: "mutates form.headers through HeaderList" },
    ]);
  });
});
