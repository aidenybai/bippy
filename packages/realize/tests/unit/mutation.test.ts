import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { createMutationCounter } from "../conformance/verifier/mutation";

const FILE = "/app/list.tsx";

const getLocation = (sourceText: string, place: string) => {
  const start = sourceText.indexOf(place);
  return {
    filename: FILE,
    identifierName: undefined,
    start: { line: 1, column: start, index: start },
    end: { line: 1, column: start + place.length, index: start + place.length },
  };
};

describe("createMutationCounter", () => {
  it("instruments a reference read for a member access", () => {
    const sourceText = "tags.push('a'); stats.clicks += 1; items?.sort(); list![0] = 1;";
    for (const place of ["tags", "stats", "items", "list"])
      expect(createMutationCounter(FILE, sourceText, getLocation(sourceText, place))).toMatchObject(
        {
          kind: "mutation",
          start: sourceText.indexOf(place),
          end: sourceText.indexOf(place) + place.length,
        },
      );
  });

  it("instruments a nested place", () => {
    const sourceText = "state.items.push(1);";
    expect(
      createMutationCounter(FILE, sourceText, getLocation(sourceText, "state.items")),
    ).not.toBeNull();
  });

  it("skips places it can't wrap without changing the code", () => {
    const sourceText = "mutate(tags); tags = []; foo(bar).baz.push(1);";
    expect(createMutationCounter(FILE, sourceText, getLocation(sourceText, "tags"))).toBeNull();
    expect(createMutationCounter(FILE, sourceText, getLocation(sourceText, "tags ="))).toBeNull();
    expect(createMutationCounter(FILE, sourceText, getLocation(sourceText, "foo(bar)"))).toBeNull();
    expect(createMutationCounter(FILE, sourceText, GeneratedSource)).toBeNull();
  });
});
