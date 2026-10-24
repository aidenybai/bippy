import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a catch after an await in a handler", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "catch-after-await.tsx"),
    "RetryForm",
  );

  it("runs after the try body, only when it throws, once the await has settled", () => {
    const [handler] = analysis.handlers;
    expect(
      handler?.updates.map((update) => [
        formatSymbolicValue(update.value),
        update.guards.map(formatSymbolicValue),
        update.isAsync,
      ]),
    ).toEqual([
      ["null", [], false],
      ['"Failed"', ["Unknown(throws)"], true],
    ]);
  });

  it("lets a submit from either state end with or without the error", () => {
    expect(report.states.map((state) => state.transitions.map((edge) => edge.targets))).toEqual([
      [[0, 1]],
      [[0, 1]],
    ]);
  });

  it("skips the rest of the try body when the await before it throws", () => {
    const upload = getComponent(
      analyzeFixture("symbolic-tree", "catch-after-await.tsx"),
      "UploadForm",
    );
    const [handler] = upload.analysis.handlers;
    expect(
      handler?.updates.map((update) => [
        formatSymbolicValue(update.value),
        update.guards.map(formatSymbolicValue),
      ]),
    ).toEqual([
      ['"uploading"', []],
      ['"processing"', ["!Unknown(throws)"]],
      ['"done"', ["!Unknown(throws)", "!Unknown(throws)"]],
      ['"Failed"', ["Unknown(throws)"]],
      ['"Failed"', ["!Unknown(throws)", "Unknown(throws)"]],
    ]);
  });
});
