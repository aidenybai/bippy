import { describe, expect, it } from "vite-plus/test";
import { getChangeDescription } from "../src/change-description.js";

describe("upstream profiler change-description behavior", () => {
  it("should identify useContext as the cause for a re-render", () => {
    expect(getChangeDescription({}, {}, undefined, undefined, 0, 1)).toEqual({
      context: true,
      didHooksChange: false,
      hooks: [],
      isFirstMount: false,
      props: [],
      state: null,
    });
  });
});
