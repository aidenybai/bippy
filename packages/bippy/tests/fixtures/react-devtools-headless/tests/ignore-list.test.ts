import { describe, expect, it } from "vite-plus/test";
import { symbolicateSource } from "../src/symbolicate-source.js";

const createFetchFile = (ignoreList: number[]) => {
  const files = new Map([
    ["http://test/bundle.js", "value();\n//# sourceMappingURL=bundle.js.map"],
    [
      "http://test/bundle.js.map",
      JSON.stringify({
        file: "bundle.js",
        ignoreList,
        mappings: "AAAA",
        names: [],
        sources: ["source.ts"],
        version: 3,
      }),
    ],
  ]);
  return async (url: string): Promise<string | null> => files.get(url) ?? null;
};

describe("upstream extension source-map ignore-list behavior", () => {
  it("should not ignore list anything", async () => {
    await expect(
      symbolicateSource(createFetchFile([]), "http://test/bundle.js", 1, 1),
    ).resolves.toEqual({
      ignored: false,
      location: ["", "http://test/source.ts", 1, 1],
    });
  });

  it("should include every source", async () => {
    await expect(
      symbolicateSource(createFetchFile([0]), "http://test/bundle.js", 1, 1),
    ).resolves.toEqual({
      ignored: true,
      location: ["", "http://test/source.ts", 1, 1],
    });
  });
});
