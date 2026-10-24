import { resolveConfig } from "vite";
import { describe, expect, it } from "vite-plus/test";
import { createImportMetaUrlFilterPlugin } from "../conformance/verifier/harness/transforms";

const getCodeFilter = (config: Awaited<ReturnType<typeof resolveConfig>>, name: string) => {
  const plugin = config.plugins.find((candidate) => candidate.name === name);
  return typeof plugin?.transform === "object" ? plugin.transform.filter?.code : undefined;
};

describe("import.meta.url filter", () => {
  it("narrows Vite's import.meta.url scans to modules that mention it", async () => {
    const config = await resolveConfig(
      { configFile: false, logLevel: "silent", plugins: [createImportMetaUrlFilterPlugin()] },
      "serve",
    );
    expect(getCodeFilter(config, "vite:asset-import-meta-url")).toBe("import.meta.url");
    expect(getCodeFilter(config, "vite:worker-import-meta-url")).toBe("import.meta.url");
  });
});
