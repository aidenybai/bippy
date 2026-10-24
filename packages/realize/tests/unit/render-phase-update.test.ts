import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("render phase update", () => {
  it("records a setter called during render as an update", () => {
    const project = analyzeFixture("conformance-repros", "render-phase-update");
    const updatedNames = getComponent(project, "SelectedChat").analysis.handlers.flatMap(
      (handler) => handler.updates.map((update) => update.binding.name),
    );
    expect(updatedNames).toContain("lastChatId");
  });
});
