import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runWithProcessEnvironment } from "../src/corpus/process-environment.js";
import {
  createViteAssetTransform,
  loadViteUserPlugins,
} from "../src/graph/vite-asset-transform.js";
import { locateViteConfig } from "../src/graph/vite-config.js";

const ROOT = join(import.meta.dirname, "fixtures/vite-node-environment");

const getEnvironment = (nodeEnvironment: string | undefined): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  if (nodeEnvironment === undefined) delete environment.NODE_ENV;
  else environment.NODE_ENV = nodeEnvironment;
  return environment;
};

const getConfigurationOutput = async (
  fileName = "message.fixture",
): Promise<string | undefined> => {
  const location = locateViteConfig({ rootDirectory: ROOT, devCommand: "vite --mode staging" });
  expect(location).not.toBeNull();
  if (!location) return;
  const plugins = await loadViteUserPlugins(location);
  expect(plugins === null).toBe(false);
  if (!plugins) return;
  return createViteAssetTransform(plugins).transform(
    join(ROOT, "src", fileName),
    "environment",
    null,
  )?.sourceText;
};

describe("Vite Node environment initialization", () => {
  it.each([undefined, "", "test", "production"])(
    "initializes configuration from %s",
    async (nodeEnvironment) => {
      await runWithProcessEnvironment(
        () => getEnvironment(nodeEnvironment),
        async () => {
          const expected = nodeEnvironment || "development";
          expect(await getConfigurationOutput()).toContain(
            JSON.stringify(`${expected}:${expected}:${expected}`),
          );
          expect(process.env.NODE_ENV).toBe(expected);
        },
      );
    },
  );

  it("preserves Vite's dotenv handling when NODE_ENV was initially absent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-vite-node-env-"));
    writeFileSync(join(directory, ".env.staging"), "NODE_ENV=production\n");
    try {
      await runWithProcessEnvironment(
        () => ({
          ...getEnvironment(undefined),
          BIPPY_VITE_ENV_DIRECTORY: directory,
        }),
        async () => {
          expect(await getConfigurationOutput("warnings.fixture")).toContain('"1"');
          expect(process.env.NODE_ENV).toBe("development");
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([undefined, "", "test"])(
    "restores %s when configuration fails",
    async (nodeEnvironment) => {
      await runWithProcessEnvironment(
        () => ({
          ...getEnvironment(nodeEnvironment),
          BIPPY_THROW_CONFIG: "1",
        }),
        async () => {
          await expect(getConfigurationOutput()).rejects.toThrow("configuration failure");
          expect(process.env.NODE_ENV).toBe(nodeEnvironment);
        },
      );
    },
  );
});
