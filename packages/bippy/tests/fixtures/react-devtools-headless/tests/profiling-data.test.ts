import { describe, expect, it } from "vitest";
import { prepareProfilingDataFrontendFromExport } from "../src/profiling-data";

describe("upstream profiling data behavior", () => {
  it("should throw if importing older/unsupported data", () => {
    expect(() => prepareProfilingDataFrontendFromExport({ dataForRoots: [], version: 0 })).toThrow(
      "Unsupported profile export version",
    );
  });
});
