import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { ConfigError } from "../../src/core/config-error";

describe("config errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-config-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("reports a malformed tsconfig instead of analyzing nothing", () => {
    const configPath = join(directory, "tsconfig.json");
    writeFileSync(configPath, '{ "compilerOptions": { "jsx": "react-jsx" }, "include": ["."]');
    expect(() => analyzeProject(configPath)).toThrow(ConfigError);
  });

  it("reports a missing tsconfig as one named error", () => {
    const configPath = join(directory, "missing", "tsconfig.json");
    expect(() => analyzeProject(configPath)).toThrow(ConfigError);
    expect(() => analyzeProject(configPath)).toThrow(/could not read/);
  });
});
