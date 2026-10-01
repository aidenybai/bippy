import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";

const execute = promisify(execFile);
const tsxPath = createRequire(import.meta.url).resolve("tsx/cli");
const helperPath = join(import.meta.dirname, "helpers/react-runtime-process.ts");

it.each(["production", "development"])(
  "settles isolated React work with %s loaded first in Node's cache",
  async (initialEnvironment) => {
    const environments = [
      initialEnvironment,
      initialEnvironment === "production" ? "development" : "production",
    ];
    const { stdout } = await execute(process.execPath, [tsxPath, helperPath, ...environments], {
      env: { ...process.env, NODE_ENV: initialEnvironment },
      timeout: 10_000,
    });
    expect(JSON.parse(stdout)).toEqual(
      environments.map((environment) => ({
        environment,
        environmentUnchanged: true,
        nativeModulesUnchanged: true,
        html: `<span>${environment}:1</span>`,
        commits: 2,
        cleanups: 1,
        errors: [],
      })),
    );
  },
);
