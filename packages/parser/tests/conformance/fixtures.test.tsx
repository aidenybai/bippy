import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStaticRenderer, type StaticRenderer } from "@bippy/parser";
import { formatVerificationReport, renderRuntimeSnapshot, verifySnapshots } from "@bippy/parser/harness";
import { createElement, type ComponentType } from "react";
import { describe, expect, it } from "vite-plus/test";

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const fixtureFiles = readdirSync(fixturesDirectory)
  .filter((fileName) => fileName.endsWith(".tsx"))
  .sort();

const isComponent = (value: unknown): value is ComponentType =>
  typeof value === "function" || (typeof value === "object" && value !== null);

let renderer: StaticRenderer | null = null;
const getRenderer = (): StaticRenderer => {
  renderer ??= createStaticRenderer({ rootDirectory: fixturesDirectory });
  return renderer;
};

describe("fixture conformance", () => {
  for (const fileName of fixtureFiles) {
    it(`${fileName} matches the committed fiber tree`, async () => {
      const filePath = join(fixturesDirectory, fileName);
      const fixture: Record<string, unknown> = await import(/* @vite-ignore */ pathToFileURL(filePath).href);
      const Component = fixture.default;
      if (!isComponent(Component)) throw new Error(`${fileName} has no default export component`);
      const runtime = await renderRuntimeSnapshot(createElement(Component));
      const staticResult = getRenderer().renderExport(filePath);
      const report = verifySnapshots(staticResult.snapshot, runtime);
      const details = [
        formatVerificationReport(report),
        staticResult.diagnostics.length > 0
          ? `diagnostics:\n${staticResult.diagnostics.map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`).join("\n")}`
          : "",
      ].join("\n\n");
      expect(report.isMatch, details).toBe(true);
    });
  }
});
