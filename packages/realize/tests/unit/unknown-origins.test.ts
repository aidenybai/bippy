import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("an unknown value names where it came from", () => {
  const project = analyzeFixture("conformance-repros", "unknown-origins");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => ({
        binding: update.binding.name,
        value: formatSymbolicValue(update.value),
        guards: update.guards.map(formatSymbolicValue),
      })),
    );

  it("names a promise that resolves or rejects", () => {
    expect(getUpdates("FetchedItems")).toEqual([
      { binding: "items", value: "await fetchItems()", guards: ["fetchItems() resolves"] },
      { binding: "failed", value: "true", guards: ["fetchItems().then(set items) rejects"] },
    ]);
  });

  it("names a member read off an event", () => {
    expect(getUpdates("DraftInput")).toEqual([
      { binding: "draft", value: "event.target.value", guards: [] },
    ]);
  });

  it("names a call it can't see into", () => {
    expect(getUpdates("StampedEntry").map((update) => update.value)).toEqual([
      "{ id: Date.now() }",
    ]);
  });
});
