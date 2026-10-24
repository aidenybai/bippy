import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("state with an unread value", () => {
  const project = analyzeFixture("conformance-repros", "hole-state");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [update.binding.name, update.binding.kind, update.isAsync]),
    );

  it("binds a state whose slot is a hole from its setter", () => {
    expect(getUpdates("HoleState")).toEqual([["tick", "state", false]]);
  });

  it("binds a state the compiler drops because nothing reads it", () => {
    expect(getUpdates("UnreadState")).toEqual([["isSaved", "state", false]]);
  });

  it("binds a reducer whose slot is a hole", () => {
    expect(getUpdates("HoleReducer")).toEqual([["state", "reducer", false]]);
  });
});
