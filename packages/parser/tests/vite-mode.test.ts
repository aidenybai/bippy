import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadViteConfiguration } from "../src/graph/vite-asset-transform.js";
import { locateViteConfig } from "../src/graph/vite-config.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const ROOT = join(import.meta.dirname, "fixtures/vite-mode");

describe("native Vite modes", () => {
  it.each([
    { command: "vite", factoryMode: "development", resolvedMode: "configured" },
    { command: "vite --mode staging", factoryMode: "staging", resolvedMode: "staging" },
    { command: "vite -m preview", factoryMode: "preview", resolvedMode: "preview" },
    { command: "vite --mode=staging", factoryMode: "staging", resolvedMode: "staging" },
    { command: "vite --mode production", factoryMode: "production", resolvedMode: "production" },
  ])(
    "uses $command in configuration and transforms",
    async ({ command, factoryMode, resolvedMode }) => {
      const renderer = await createStaticRenderer({ rootDirectory: ROOT, devCommand: command });
      const rendered = await renderer.renderEntry("src/main.tsx");
      const pattern = formatPattern(getRenderPattern(rendered));
      expect(pattern).toContain(JSON.stringify(`${factoryMode}:${resolvedMode}`));
      expect(pattern).toContain(JSON.stringify(resolvedMode));
    },
  );

  it.each(["vite --mode=", "vite --mode", "vite -m"])("rejects a missing mode in %s", (command) => {
    expect(() => locateViteConfig({ rootDirectory: ROOT, devCommand: command })).toThrow(
      "mode requires a value",
    );
  });

  it("filters plugins using the CLI mode rather than the config's fallback", async () => {
    const location = locateViteConfig({ rootDirectory: ROOT, devCommand: "vite --mode disabled" });
    expect(location).not.toBeNull();
    if (!location) return;
    expect((await loadViteConfiguration(location))?.plugins).toEqual([]);
  });
});
