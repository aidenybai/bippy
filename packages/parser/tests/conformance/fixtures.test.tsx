import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStaticRenderer, type StaticRenderer } from "@bippy/parser";
import {
  formatCoverage,
  formatVerificationReport,
  renderRuntimeSnapshot,
  verifySnapshots,
} from "@bippy/parser/harness";
import { createElement, type ComponentType } from "react";
import { describe, expect, it } from "vite-plus/test";

/**
 * Every fixture renders its default export both ways. The runtime tree must
 * be one of the trees the static analysis describes, and unless the fixture
 * exports `minCoverage` every runtime fiber must be explained by a concrete
 * static fiber, so a match cannot be bought with wildcards.
 */
const FIXTURE_EXTENSIONS = [".tsx", ".jsx", ".js"];

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const fixtureFiles = readdirSync(fixturesDirectory)
  .filter((fileName) => FIXTURE_EXTENSIONS.some((extension) => fileName.endsWith(extension)))
  .sort();

const isComponent = (value: unknown): value is ComponentType =>
  typeof value === "function" || (typeof value === "object" && value !== null);

const getMinCoverage = (fixture: Record<string, unknown>): number =>
  typeof fixture.minCoverage === "number" ? fixture.minCoverage : 1;

let renderer: StaticRenderer | null = null;
const getRenderer = (): StaticRenderer => {
  renderer ??= createStaticRenderer({ rootDirectory: fixturesDirectory });
  return renderer;
};

describe("fixture conformance", () => {
  for (const fileName of fixtureFiles) {
    it(`${fileName} matches the committed fiber tree`, async () => {
      const filePath = join(fixturesDirectory, fileName);
      const fixture: Record<string, unknown> = await import(
        /* @vite-ignore */ pathToFileURL(filePath).href
      );
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
      const minCoverage = getMinCoverage(fixture);
      expect(
        report.coverage >= minCoverage,
        `coverage ${formatCoverage(report.coverage)} is below the fixture's ${formatCoverage(minCoverage)} floor\n\n${details}`,
      ).toBe(true);
    });
  }
});
