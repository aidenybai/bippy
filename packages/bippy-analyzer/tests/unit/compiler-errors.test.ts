import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("compiler errors", () => {
  const project = analyzeFixture("conformance-repros");

  it.each([["BreakOutOfTry", /finalizer .* and an early exit/]])(
    "keeps %s as a compiler-error bailout with the compiler's reason",
    (name, reason) => {
      const [bailout] = getComponent(project, name).analysis.bailouts;
      expect(bailout?.reason).toBe("compiler-error");
      expect(bailout?.message).toMatch(reason);
    },
  );

  it.each(["SaveButton", "DownloadButton", "UploadButton", "RetryButton"])(
    "lowers the finally clause of %s before each way out of its try and catch blocks",
    (name) => {
      expect(getComponent(project, name).analysis.bailouts).toEqual([]);
    },
  );

  it.each([
    ["DraftTitle", "DraftTitleSpelledOut"],
    ["SeenCounter", "SeenCounterSpelledOut"],
  ])("lowers the logical assignments in %s as %s spells them out", (name, spelledOutName) => {
    const describeStates = (componentName: string) => {
      const { analysis, report } = getComponent(project, componentName);
      expect(analysis.bailouts).toEqual([]);
      return report.states.map((state) => [state.conditions, formatSymbolicValue(state.render)]);
    };
    expect(describeStates(name)).toEqual(describeStates(spelledOutName));
  });

  it.each(["ThemeCycler", "PageSizePicker"])(
    "binds the function %s declares, not the local or parameter of the same name inside it",
    (name) => {
      const { analysis, report } = getComponent(project, name);
      expect(analysis.bailouts).toEqual([]);
      expect(report.states).toHaveLength(2);
    },
  );

  it.each(["TileCount", "CursorTrail"])(
    "captures the variables %s's nested function reassigns by destructuring",
    (name) => {
      expect(getComponent(project, name).analysis.bailouts).toEqual([]);
    },
  );

  it("reads an empty tuple branch TypeScript can't serialize as a value it can't see into", () => {
    const { analysis, report } = getComponent(project, "DateRange");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(2);
  });

  it("reads a named function expression's own name as a value it can't see into", () => {
    const { analysis, report } = getComponent(project, "FrameCounter");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(2);
  });

  it("lowers a dynamic import as a value it can't see into", () => {
    expect(getComponent(project, "DynamicImport").analysis.bailouts).toEqual([]);
  });

  it("keeps a try whose catch is empty once a step in it can no longer throw", () => {
    const { analysis, report } = getComponent(project, "SearchResults");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["Unknown(throws)"],
      ["!Unknown(throws)", "searchTitles(query, 20).length === 0"],
      ["!Unknown(throws)", "searchTitles(query, 20).length !== 0"],
    ]);
  });

  it("assigns through a type cast on the left of an assignment", () => {
    const { analysis, report } = getComponent(project, "SettingsForm");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.handlers.map((handler) => handler.updates[0]?.binding.name)).toEqual([
      "settings",
      "settings",
    ]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["!settings.title"],
      ["settings.title"],
    ]);
  });

  it("lowers function declarations after the return they're used in", () => {
    const { analysis, report } = getComponent(project, "Stepper");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.handlers.map((handler) => handler.updates[0]?.binding.name)).toEqual([
      "count",
      "count",
    ]);
    expect(report.states).toHaveLength(2);
  });

  it("reassigns a destructured field that a closure captures", () => {
    const { analysis } = getComponent(project, "CaptionLayout");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.handlers[0]?.updates.map((update) => update.binding.name)).toEqual([
      "lines",
      "nextLineId",
    ]);
  });

  it("lowers a computed key in a destructuring pattern", () => {
    const { analysis } = getComponent(project, "SelectedTags");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.handlers.map((handler) => handler.updates.length)).toEqual([1]);
  });

  it("lowers a spread child as the array it spreads", () => {
    const { analysis, report } = getComponent(project, "ThemePicker");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(1);
    expect(analysis.handlers).toHaveLength(1);
  });
});
