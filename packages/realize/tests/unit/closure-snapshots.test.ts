import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("closure snapshots", () => {
  it("reads state after an await from the render that made the handler", async () => {
    const { model } = getComponent(
      await analyzeFixture("conformance-repros", "async-handler-tails"),
      "SendRequest",
    );
    expect(model.stateSpace.edges.map((edge) => edge.to)).toContain('div > p "Failed"');
  });
});
