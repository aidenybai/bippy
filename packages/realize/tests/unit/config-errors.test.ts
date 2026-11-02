import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { ConfigError } from "../../src/core/project/config-error";

describe("config errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-config-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("reports a malformed tsconfig instead of analyzing nothing", async () => {
    const configPath = join(directory, "tsconfig.json");
    writeFileSync(configPath, '{ "compilerOptions": { "jsx": "react-jsx" }, "include": ["."]');
    await expect(analyzeProject(configPath)).rejects.toThrow(ConfigError);
  });

  it("reports a missing tsconfig as one named error", async () => {
    const configPath = join(directory, "missing", "tsconfig.json");
    await expect(analyzeProject(configPath)).rejects.toThrow(ConfigError);
    await expect(analyzeProject(configPath)).rejects.toThrow(/could not read/);
  });
});
