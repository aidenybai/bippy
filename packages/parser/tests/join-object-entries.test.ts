import { describe, expect, it } from "vite-plus/test";
import {
  describeValue,
  getObjectProperty,
  hasOwnKey,
  joinObjectEntries,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import type { StaticObjectEntry } from "../src/types.js";

const property = (key: string, value: number): StaticObjectEntry => ({
  kind: "property",
  key,
  value: primitiveValue(value),
});

const dynamicWrite = (): StaticObjectEntry => ({
  kind: "spread",
  value: unknownValue("property set through an unknown key"),
});

describe("joinObjectEntries", () => {
  it("keeps only what each path appended behind the joined spread", () => {
    const original = [property("a", 1)];
    const joined = joinObjectEntries(
      original,
      [
        [...original, dynamicWrite()],
        [...original, property("b", 2)],
      ],
      "if (isWide)",
      null,
      0,
      null,
    );
    expect(joined.slice(0, original.length)).toEqual(original);
    expect(joined).toHaveLength(original.length + 1);
    const [spread] = joined.slice(original.length);
    expect(spread?.kind).toBe("spread");
    if (spread?.kind !== "spread" || spread.value.kind !== "branch") throw new Error("no branch");
    expect(spread.value.alternatives.map(describeValue)).toEqual(["{...}", "{b}"]);
    for (const alternative of spread.value.alternatives) {
      if (alternative.kind !== "object") throw new Error("not an object");
      expect(alternative.entries).toHaveLength(1);
    }
    const object = objectValue(joined);
    expect(describeValue(getObjectProperty(object, "a"))).toBe("branch(unknown | 1)");
    expect(describeValue(getObjectProperty(object, "b"))).toBe("branch(unknown | 2)");
    expect(hasOwnKey(object, "a")).toBe(true);
    expect(hasOwnKey(object, "b")).toBeNull();
  });

  it("does not let repeated joins nest the whole object under its own spread", () => {
    let entries: StaticObjectEntry[] = [property("a", 1)];
    for (let round = 0; round < 40; round++) {
      entries = joinObjectEntries(
        entries,
        [[...entries, dynamicWrite()], entries],
        "loop iterations are uncertain",
        null,
        0,
        null,
      );
    }
    expect(entries).toHaveLength(41);
    const started = performance.now();
    expect(hasOwnKey(objectValue(entries), "missing")).toBeNull();
    expect(hasOwnKey(objectValue(entries), "a")).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("keeps whole path objects when a path rewrote earlier entries", () => {
    const original = [property("a", 1), dynamicWrite()];
    const joined = joinObjectEntries(
      original,
      [[property("a", 2), dynamicWrite()], original],
      "if (isWide)",
      null,
      0,
      null,
    );
    const [spread] = joined.slice(original.length);
    if (spread?.kind !== "spread" || spread.value.kind !== "branch") throw new Error("no branch");
    for (const alternative of spread.value.alternatives) {
      if (alternative.kind !== "object") throw new Error("not an object");
      expect(alternative.entries).toHaveLength(2);
    }
  });
});
