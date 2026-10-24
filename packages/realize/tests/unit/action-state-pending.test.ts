import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("pending action state", () => {
  const project = analyzeFixture("conformance-repros", "action-state-pending");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [
        update.binding.name,
        update.isAsync,
        update.value.kind === "Primitive" ? update.value.value : update.value.kind,
      ]),
    );

  it("sets isPending around an async action", () => {
    expect(getUpdates("AsyncAction")).toEqual([
      ["isPending", false, true],
      ["status", true, "saved"],
      ["isPending", true, false],
    ]);
  });

  it("settles a sync action at once", () => {
    expect(getUpdates("SyncAction")).toEqual([["status", false, "saved"]]);
  });
});
