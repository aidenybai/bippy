import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/core/hir/hir.js";
import { createMutationProbe } from "./mutation.js";

const FILE = "/app/list.tsx";

const getLocation = (sourceText: string, place: string) => {
  const start = sourceText.indexOf(place);
  return { filename: FILE, start, end: start + place.length, line: 1, column: start };
};

describe("createMutationProbe", () => {
  it("probes a reference read for a member access", () => {
    const sourceText = "tags.push('a'); stats.clicks += 1; items?.sort(); list![0] = 1;";
    for (const place of ["tags", "stats", "items", "list"])
      expect(createMutationProbe(FILE, sourceText, getLocation(sourceText, place))).toMatchObject({
        mode: "mutation",
        start: sourceText.indexOf(place),
        end: sourceText.indexOf(place) + place.length,
      });
  });

  it("probes a nested place", () => {
    const sourceText = "state.items.push(1);";
    expect(
      createMutationProbe(FILE, sourceText, getLocation(sourceText, "state.items")),
    ).not.toBeNull();
  });

  it("skips places it can't wrap without changing the code", () => {
    const sourceText = "mutate(tags); tags = []; foo(bar).baz.push(1);";
    expect(createMutationProbe(FILE, sourceText, getLocation(sourceText, "tags"))).toBeNull();
    expect(createMutationProbe(FILE, sourceText, getLocation(sourceText, "tags ="))).toBeNull();
    expect(createMutationProbe(FILE, sourceText, getLocation(sourceText, "foo(bar)"))).toBeNull();
    expect(createMutationProbe(FILE, sourceText, GeneratedSource)).toBeNull();
  });
});
