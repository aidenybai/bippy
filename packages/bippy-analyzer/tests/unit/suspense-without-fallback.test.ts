import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("suspense without fallback", () => {
  it("keeps a suspended state that renders nothing", () => {
    const project = analyzeFixture("conformance-repros", "suspense-without-fallback");
    expect(getComponent(project, "CheckoutPage").report.states).toHaveLength(2);
  });
});
