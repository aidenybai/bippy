import { describe, expect, it } from "vite-plus/test";
import { copyWithDelete, copyWithRename, copyWithSet } from "../src/object-path.js";

describe("upstream editable path behavior", () => {
  it("replaces a root value", () => {
    expect(copyWithSet({ before: true }, [], { after: true })).toEqual({ after: true });
    expect(copyWithDelete({ before: true }, [])).toBeUndefined();
  });

  it("sets nested properties and creates missing containers immutably", () => {
    const source = { array: [1, 2], nested: { before: true } };
    const nested = copyWithSet(source, ["nested", "after"], true);
    const appended = copyWithSet(nested, ["array", 2], 3);
    const createdObject = copyWithSet(appended, ["missing", "value"], 4);
    const createdArray = copyWithSet(createdObject, ["list", 0], "first");

    expect(source).toEqual({ array: [1, 2], nested: { before: true } });
    expect(createdArray).toEqual({
      array: [1, 2, 3],
      list: ["first"],
      missing: { value: 4 },
      nested: { after: true, before: true },
    });
  });

  it("deletes object properties and splices array entries immutably", () => {
    const source = { array: [1, 2, 3], nested: { keep: true, remove: true } };
    const deletedProperty = copyWithDelete(source, ["nested", "remove"]);
    const deletedEntry = copyWithDelete(deletedProperty, ["array", 1]);

    expect(source).toEqual({
      array: [1, 2, 3],
      nested: { keep: true, remove: true },
    });
    expect(deletedEntry).toEqual({ array: [1, 3], nested: { keep: true } });
  });

  it("renames shallow and nested paths while preserving the source", () => {
    const source = { before: 1, nested: { old: 2 } };
    const shallow = copyWithRename(source, ["before"], ["after"]);
    const nested = copyWithRename(shallow, ["nested", "old"], ["nested", "new"]);

    expect(source).toEqual({ before: 1, nested: { old: 2 } });
    expect(nested).toEqual({ after: 1, nested: { new: 2 } });
  });

  it("ignores invalid root rename paths", () => {
    const source = { value: true };
    expect(copyWithRename(source, [], ["after"])).toBe(source);
    expect(copyWithRename(source, ["value"], [])).toBe(source);
  });
});
