import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { locateViteConfig } from "../src/graph/vite-config.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const ROOT = join(import.meta.dirname, "fixtures/tanstack-router-split");
const EXTERNAL_PACKAGES = [
  "@tanstack/react-router",
  "@tanstack/router-core",
  "@tanstack/history",
  "@tanstack/react-store",
  "@tanstack/store",
];

describe("native Vite project paths", () => {
  it.each(["root", "dev"])(
    "uses canonical paths for a symlinked %s directory",
    async (directoryKind) => {
      const directory = mkdtempSync(join(tmpdir(), "bippy-vite-paths-"));
      const alias = join(directory, "app");
      symlinkSync(ROOT, alias, "dir");
      try {
        const options = {
          rootDirectory: directoryKind === "root" ? alias : ROOT,
          devDirectory: directoryKind === "dev" ? alias : undefined,
          externalPackageAllowList: EXTERNAL_PACKAGES,
          route: "/",
        };
        const renderer = await createStaticRenderer(options);
        const rendered = await renderer.renderEntry("src/main.tsx");
        expect(formatPattern(getRenderPattern(rendered))).toContain("<Lazy>");
        const location = locateViteConfig(options);
        expect(location?.cwd).toBe(realpathSync(ROOT));
        expect(location?.configPath).toBe(join(realpathSync(ROOT), "vite.config.ts"));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
