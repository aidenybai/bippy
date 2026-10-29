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

describe("conditional mutations", () => {
  it("warns when a value that may be the prop itself is sorted in place", () => {
    const project = analyzeFixture("conformance-repros", "callback-item-mutations");
    expect(getComponent(project, "SortedOptions").analysis.warnings).toMatchObject([
      { kind: "prop-mutation", message: "mutates prop options" },
    ]);
  });
});

describe("helper mutations through a copy", () => {
  const project = analyzeFixture("conformance-repros", "copied-helper-mutations");

  it.each(["SlicedRowsHelper", "SpreadRowsLoopHelper"])(
    "warns when %s passes a copy to a helper that mutates its rows",
    (name) => {
      expect(getComponent(project, name).analysis.warnings).toMatchObject([
        { kind: "state-mutation", message: "mutates rows in place before setting it" },
      ]);
    },
  );

  it("warns when render passes a copy to a helper that mutates its rows", () => {
    expect(getComponent(project, "CopiedRowsInRender").analysis.warnings).toMatchObject([
      { kind: "render-mutation", message: "mutates rows during render" },
    ]);
  });

  it("stays quiet when the helper only appends to the copy", () => {
    expect(getWarningKinds(getComponent(project, "AppendedCopyHelper"))).toEqual([]);
  });
});
