import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

const COPIES = [
  "SliceCopy",
  "ArrayFromCopy",
  "ObjectValuesCopy",
  "ObjectEntriesCopy",
  "FlatCopy",
  "WithCopy",
  "ReversedSpread",
];

describe("an element taken out of a copy of state", () => {
  const project = analyzeFixture("conformance-repros", "shared-element-aliases");

  const getWarningKinds = (name: string) =>
    getComponent(project, name).analysis.warnings.map((warning) => warning.kind);

  it.each(COPIES)("%s warns when a handler writes to it", (name) => {
    expect(getWarningKinds(name)).toEqual(["state-mutation"]);
  });

  it.each([
    ...COPIES.map((name) => `${name}InRender`),
    "DestructuredInRender",
    "ForOfInRender",
    "NestedPatternInRender",
  ])("%s warns when render writes to it", (name) => {
    expect(getWarningKinds(name)).toEqual(["render-mutation"]);
  });

  it.each(["SlicePushed", "ArrayFromPushed", "ReversedSpreadOnly", "ClonedElement"])(
    "%s writes only to its own copy and warns nothing",
    (name) => {
      expect(getWarningKinds(name)).toEqual([]);
    },
  );
});
