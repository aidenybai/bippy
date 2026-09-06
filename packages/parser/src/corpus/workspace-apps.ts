import type { CorpusCheckout, CorpusFramework, LiveTarget } from "./repositories.js";

/**
 * A fixture app inside this monorepo. Its dependencies are installed with
 * the workspace, which makes it the fastest way to exercise the live
 * pipeline end to end; paths are relative to the monorepo root.
 */
export interface WorkspaceApp {
  /** Workspace package name. */
  name: string;
  framework: CorpusFramework;
  reactVersion: string;
  appDirectory: string;
  entryFiles: string[];
  live: LiveTarget;
}

const devCommand = (packageName: string, port: number): string =>
  `pnpm --filter ${packageName} dev --port ${port} --strictPort --host 127.0.0.1`;

export const WORKSPACE_APPS: WorkspaceApp[] = [
  {
    name: "@bippy/e2e-vite",
    framework: "vite",
    reactVersion: "^19.0.0",
    appDirectory: "packages/e2e/fixtures/vite-app/src",
    entryFiles: ["packages/e2e/fixtures/vite-app/src/main.tsx"],
    live: {
      installCommand: null,
      devCommand: devCommand("@bippy/e2e-vite", 5280),
      port: 5280,
      entryFile: "packages/e2e/fixtures/vite-app/src/main.tsx",
      readyTimeoutMs: 60_000,
    },
  },
  {
    name: "@bippy/e2e-kitchen-sink",
    framework: "vite",
    reactVersion: "^19.0.0",
    appDirectory: "packages/e2e/fixtures/kitchen-sink-app/src",
    entryFiles: ["packages/e2e/fixtures/kitchen-sink-app/src/main.tsx"],
    live: {
      installCommand: null,
      devCommand: devCommand("@bippy/e2e-kitchen-sink", 5299),
      port: 5299,
      entryFile: "packages/e2e/fixtures/kitchen-sink-app/src/main.tsx",
      readyTimeoutMs: 120_000,
    },
  },
  {
    name: "@bippy/e2e-rsbuild",
    framework: "rsbuild",
    reactVersion: "^19.0.0",
    appDirectory: "packages/e2e/fixtures/rsbuild-app/src",
    entryFiles: ["packages/e2e/fixtures/rsbuild-app/src/index.tsx"],
    live: {
      installCommand: null,
      devCommand: "pnpm --filter @bippy/e2e-rsbuild dev --port 5500 --host 127.0.0.1",
      port: 5500,
      entryFile: "packages/e2e/fixtures/rsbuild-app/src/index.tsx",
      readyTimeoutMs: 60_000,
    },
  },
  {
    name: "@bippy/e2e-tanstack",
    framework: "vite",
    reactVersion: "^19.0.0",
    appDirectory: "packages/e2e/fixtures/tanstack-app/src",
    entryFiles: ["packages/e2e/fixtures/tanstack-app/src/client.tsx"],
    live: {
      installCommand: null,
      devCommand: devCommand("@bippy/e2e-tanstack", 5300),
      port: 5300,
      entryFile: "packages/e2e/fixtures/tanstack-app/src/client.tsx",
      readyTimeoutMs: 120_000,
    },
  },
  {
    name: "@bippy/e2e-react-router",
    framework: "react-router",
    reactVersion: "^19.0.0",
    appDirectory: "packages/e2e/fixtures/react-router-app/app",
    entryFiles: ["packages/e2e/fixtures/react-router-app/app/entry.client.tsx"],
    live: {
      installCommand: null,
      devCommand: devCommand("@bippy/e2e-react-router", 5400),
      port: 5400,
      entryFile: "packages/e2e/fixtures/react-router-app/app/entry.client.tsx",
      readyTimeoutMs: 120_000,
    },
  },
];

export const toWorkspaceCheckout = (app: WorkspaceApp, monorepoRoot: string): CorpusCheckout => ({
  name: app.name,
  rootDirectory: monorepoRoot,
  appDirectory: app.appDirectory,
  entryFiles: app.entryFiles,
  framework: app.framework,
  reactVersion: app.reactVersion,
  live: app.live,
  commit: null,
  moduleDirectories: [],
});
