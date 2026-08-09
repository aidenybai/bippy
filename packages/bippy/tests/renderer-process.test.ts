import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";

interface RuntimeResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bippyEntryUrl = pathToFileURL(resolve(packageDirectory, "src/index.ts")).href;
const hookEntryUrl = pathToFileURL(resolve(packageDirectory, "src/install-hook-only.ts")).href;

const runNode = (script: string, environment: NodeJS.ProcessEnv = {}): RuntimeResult => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      env: { ...process.env, ...environment },
      timeout: 15_000,
    },
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

const runBun = (script: string): RuntimeResult | null => {
  const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bunVersion.error) return null;
  const result = spawnSync("bun", ["--eval", script], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

const createRendererReportScript = (entryUrl: string, rendererImport: string): string => `
  delete globalThis.window;
  await import(${JSON.stringify(entryUrl)});
  await import(${JSON.stringify(rendererImport)});
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  console.log(JSON.stringify({
    hasWindow: typeof globalThis.window !== "undefined",
    renderers: hook?.renderers.size,
    names: [...(hook?.renderers.values() ?? [])].map((renderer) => renderer.rendererPackageName),
  }));
  process.exit(0);
`;

describe("DOM-less renderer injection", () => {
  it("captures OpenTUI from the normal Bippy entry in Node", () => {
    const result = runNode(createRendererReportScript(bippyEntryUrl, "@opentui/react"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"hasWindow":false');
    expect(result.stdout).toContain('"renderers":1');
    expect(result.stdout).toContain('"@opentui/react"');
  });

  it("captures OpenTUI from the hook-only prelude in Bun when available", () => {
    const result = runBun(createRendererReportScript(hookEntryUrl, "@opentui/react"));
    if (!result) return;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"hasWindow":false');
    expect(result.stdout).toContain('"renderers":1');
    expect(result.stdout).toContain('"@opentui/react"');
  });

  it("preserves OpenTUI when Ink replaces the hook with React DevTools", () => {
    const script = `
      delete globalThis.window;
      await import(${JSON.stringify(bippyEntryUrl)});
      await import("@opentui/react");
      const React = await import("react");
      const { Text } = await import("ink");
      const { render } = await import("ink-testing-library");
      const instance = render(React.createElement(Text, null, "ok"));
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      console.log(JSON.stringify({
        renderers: hook?.renderers.size,
        names: [...(hook?.renderers.values() ?? [])]
          .map((renderer) => renderer.rendererPackageName)
          .sort(),
      }));
      instance.cleanup();
      process.exit(0);
    `;
    const result = runNode(script, { DEV: "true" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"renderers":2');
    expect(result.stdout).toContain('"@opentui/react"');
    expect(result.stdout).toContain('"ink"');
  });
});
