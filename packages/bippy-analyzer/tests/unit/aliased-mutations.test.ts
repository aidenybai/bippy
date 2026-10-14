import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent, getWarningKinds } from "./helpers";

describe("aliased mutations", () => {
  const project = analyzeFixture("conformance-repros", "shallow-copy-rows");

  it.each(["DirectRowEdit", "CopiedRowEdit", "IndexedRowEdit", "IndexedDirectEdit"])(
    "warns when %s mutates a row it read from state",
    (name) => {
      expect(getComponent(project, name).analysis.warnings).toMatchObject([
        { kind: "state-mutation", message: "mutates rows in place before setting it" },
      ]);
    },
  );

  it.each(["ClonedRowEdit", "AppendedRowEdit"])(
    "stays quiet when %s mutates a fresh copy",
    (name) => {
      expect(getWarningKinds(getComponent(project, name))).toEqual([]);
    },
  );
});

describe("iteration callback mutations", () => {
  const project = analyzeFixture("conformance-repros", "callback-item-mutations");

  it("warns when a handler's forEach callback mutates state items", () => {
    expect(getComponent(project, "CompleteAllTasks").analysis.warnings).toMatchObject([
      { kind: "state-mutation", message: "mutates tasks in place before setting it" },
    ]);
  });

  it("warns when a render-time forEach callback mutates prop items", () => {
    expect(getComponent(project, "HighlightProps").analysis.warnings).toMatchObject([
      { kind: "prop-mutation", message: "mutates prop series" },
    ]);
  });

  it("stays quiet when the callback mutates cloned items", () => {
    expect(getWarningKinds(getComponent(project, "CompleteCopiedTasks"))).toEqual([]);
  });
});
