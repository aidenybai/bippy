import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { InstalledModules } from "../src/libraries/installed-modules.js";

const writeJsonModule = (directory: string, value: unknown): void => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ main: "value.json" }));
  writeFileSync(join(directory, "value.json"), JSON.stringify(value));
};

describe("installed module resolution", () => {
  it("loads the copy owned by a dependency chain instead of the project's copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-installed-"));
    try {
      const parentDirectory = join(directory, "node_modules/parent");
      const childDirectory = join(parentDirectory, "node_modules/child");
      writeJsonModule(parentDirectory, {});
      writeJsonModule(childDirectory, {});
      writeJsonModule(join(directory, "node_modules/target"), { origin: "root" });
      writeJsonModule(join(childDirectory, "node_modules/target"), { origin: "nested" });
      const installed = new InstalledModules(directory);
      expect(installed.load("target")).toEqual({ origin: "root" });
      expect(installed.load("target", ["parent", "child"])).toEqual({ origin: "nested" });
      expect(installed.load("child", "parent")).toEqual({});
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
