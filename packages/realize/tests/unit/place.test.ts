import { describe, expect, it } from "vite-plus/test";
import { PlaceMap } from "../../src/core/values/place-map";
import { isPlacePrefix } from "../../src/core/values/is-place-prefix";

describe("places", () => {
  it("keeps a field whose name has a dot apart from a nested field", () => {
    const places = new PlaceMap<string>()
      .set({ bindingId: 1, path: ["a.b"] }, "dotted")
      .set({ bindingId: 1, path: ["a", "b"] }, "nested");
    expect(places.get({ bindingId: 1, path: ["a.b"] })).toBe("dotted");
    expect(places.get({ bindingId: 1, path: ["a", "b"] })).toBe("nested");
  });

  it("treats a binding as a prefix of its fields but not of another binding", () => {
    expect(isPlacePrefix({ bindingId: 1, path: [] }, { bindingId: 1, path: ["a"] })).toBe(true);
    expect(isPlacePrefix({ bindingId: 1, path: [] }, { bindingId: 12, path: [] })).toBe(false);
    expect(isPlacePrefix({ bindingId: 1, path: ["a"] }, { bindingId: 1, path: ["ab"] })).toBe(
      false,
    );
  });
});
