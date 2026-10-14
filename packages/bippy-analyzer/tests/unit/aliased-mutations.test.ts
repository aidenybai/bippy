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
