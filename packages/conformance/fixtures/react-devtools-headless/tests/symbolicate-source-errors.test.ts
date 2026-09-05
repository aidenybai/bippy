import { describe, expect, it } from "vite-plus/test";
import { symbolicateSource } from "../src/symbolicate-source.js";

describe("source symbolication failures", () => {
  it("rejects empty and anonymous source URLs", async () => {
    const fetchFile = async () => "";
    await expect(symbolicateSource(fetchFile, "", 1, 1)).resolves.toBeNull();
    await expect(symbolicateSource(fetchFile, "<anonymous>", 1, 1)).resolves.toBeNull();
  });

  it("handles failed and missing source fetches", async () => {
    await expect(
      symbolicateSource(
        async () => Promise.reject(new Error("fetch")),
        "http://test/file.js",
        1,
        1,
      ),
    ).resolves.toBeNull();
    await expect(
      symbolicateSource(async () => null, "http://test/file.js", 1, 1),
    ).resolves.toBeNull();
  });

  it("handles resources without source map annotations", async () => {
    await expect(
      symbolicateSource(async () => "\n//# other=true\n", "http://test/file.js", 1, 1),
    ).resolves.toBeNull();
    await expect(
      symbolicateSource(async () => "const value = 1;", "http://test/file.js", 1, 1),
    ).resolves.toBeNull();
  });

  it("handles missing and invalid source maps", async () => {
    const missingMap = async (url: string) =>
      url.endsWith("file.js") ? "//# sourceMappingURL=file.js.map" : null;
    await expect(symbolicateSource(missingMap, "http://test/file.js", 1, 1)).resolves.toBeNull();
    const invalidMap = async (url: string) =>
      url.endsWith("file.js") ? "//# sourceMappingURL=file.js.map" : "invalid";
    await expect(symbolicateSource(invalidMap, "http://test/file.js", 1, 1)).resolves.toBeNull();
  });
});
