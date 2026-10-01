import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { CorpusEntry } from "../src/corpus/manifest.js";
import { createCorpusEntryRenderer } from "../src/corpus/render-entry.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";

const ROOT = join(import.meta.dirname, "fixtures/corpus-environment");
const getEntry = (value: string): CorpusEntry => ({
  id: "corpus-environment",
  repository: "https://example.invalid/environment",
  revision: "0",
  description: "Environment-sensitive compiler fixture",
  framework: "spa",
  workingDirectory: ".",
  install: "true",
  dev: "vite",
  env: { BIPPY_ENVIRONMENT_CHECK: value, VITE_LABEL: value },
  url: "http://localhost/",
  static: { rootDirectory: ".", entry: "src/main.tsx" },
});

const withHarnessEnvironment = async (run: () => Promise<void>): Promise<void> => {
  const original = process.env;
  process.env = {
    ...original,
    CI: "parent",
    BIPPY_ENVIRONMENT_CHECK: "parent",
    VITE_LABEL: "parent",
  };
  try {
    await run();
  } finally {
    process.env = original;
    Reflect.deleteProperty(globalThis, "__bippyEnvironmentApplicationRan");
  }
};

describe("corpus build environments", () => {
  it.each([
    { value: "declared", ciValue: undefined },
    { value: "other", ciValue: "1" },
  ])(
    "binds $value with CI=$ciValue to config loading and later transforms",
    async ({ value, ciValue }) => {
      await withHarnessEnvironment(async () => {
        const environmentBefore = process.env;
        const entry = getEntry(value);
        if (ciValue !== undefined) entry.env = { ...entry.env, CI: ciValue };
        const renderer = await createCorpusEntryRenderer(entry, ROOT);
        expect(process.env === environmentBefore).toBe(true);
        process.env.BIPPY_ENVIRONMENT_CHECK = "changed";
        process.env.CI = "changed";
        const rendered = await renderer.render();
        const pattern = formatPattern(getRenderPattern(rendered));
        const expected = `${value}:${ciValue ?? "unset"}`;
        expect(pattern).toContain(JSON.stringify(`${expected}|${expected}`));
        expect(pattern).toContain(JSON.stringify(value));
        expect(Reflect.get(globalThis, "__bippyEnvironmentApplicationRan")).toBeUndefined();
        expect(process.env === environmentBefore).toBe(true);
        expect(process.env.CI).toBe("changed");
        expect(process.env.BIPPY_ENVIRONMENT_CHECK).toBe("changed");
      });
    },
  );

  it("keeps concurrent entries separate and restores the harness", async () => {
    await withHarnessEnvironment(async () => {
      const environmentBefore = process.env;
      const values = ["first", "second"];
      const renderers = await Promise.all(
        values.map((value) => createCorpusEntryRenderer(getEntry(value), ROOT)),
      );
      expect(process.env === environmentBefore).toBe(true);
      const results = await Promise.all(renderers.map((renderer) => renderer.render()));
      for (const [index, rendered] of results.entries()) {
        expect(formatPattern(getRenderPattern(rendered))).toContain(
          JSON.stringify(`${values[index]}:unset|${values[index]}:unset`),
        );
      }
      expect(process.env === environmentBefore).toBe(true);
      expect(process.env.CI).toBe("parent");
    });
  });

  it("restores the harness environment when configuration fails", async () => {
    await withHarnessEnvironment(async () => {
      const environmentBefore = process.env;
      await expect(createCorpusEntryRenderer(getEntry("throw"), ROOT)).rejects.toThrow(
        "configuration failure",
      );
      expect(process.env === environmentBefore).toBe(true);
      expect(process.env.CI).toBe("parent");
      expect(process.env.BIPPY_ENVIRONMENT_CHECK).toBe("parent");
      const renderer = await createCorpusEntryRenderer(getEntry("recovered"), ROOT);
      expect(formatPattern(getRenderPattern(await renderer.render()))).toContain(
        '"recovered:unset|recovered:unset"',
      );
      expect(process.env === environmentBefore).toBe(true);
    });
  });
});
