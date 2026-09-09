import path from "node:path";
import { renderFrameworkTarget } from "../frameworks/render-framework.js";
import type { RuntimeObservations, StaticRenderResult, StaticRendererOptions } from "../types.js";
import { getSettleMs, type CorpusEntry } from "./manifest.js";
import { readProcessEnvironment } from "./process-environment.js";

const rendererOptionsForEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): StaticRendererOptions => {
  const rootDirectory = path.join(cloneDirectory, entry.static.rootDirectory);
  return {
    rootDirectory,
    servedDirectory: entry.static.servedDirectory,
    publicDirectory: entry.static.publicDirectory,
    tsconfigPath: path.join(rootDirectory, entry.static.tsconfig ?? "tsconfig.json"),
    aliases: entry.static.aliases,
    externalPackageAllowList: entry.static.externalPackageAllowList,
    bootstrap: entry.static.bootstrap,
    globals: entry.static.globals,
    defines: entry.static.defines,
    environment: readProcessEnvironment(entry, rootDirectory),
    devCommand: entry.dev,
    devDirectory: path.join(cloneDirectory, entry.workingDirectory),
    origin: new URL(entry.url).origin,
    observations,
    maxSteps: entry.static.maxSteps,
    maxFiberCount: entry.static.maxFiberCount,
    maxComponentDepth: entry.static.maxComponentDepth,
    settleMs: getSettleMs(entry),
  };
};

const getPageRoute = (url: string): string => {
  const { pathname, search, hash } = new URL(url);
  return `${pathname}${search}${hash}`;
};

export const renderCorpusEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): Promise<StaticRenderResult> =>
  renderFrameworkTarget(
    {
      framework: entry.framework,
      entry: entry.static.entry,
      route: entry.static.route ?? getPageRoute(entry.url),
      appDirectory: entry.static.appDirectory,
      rootComponent: entry.static.rootComponent,
    },
    rendererOptionsForEntry(entry, cloneDirectory, observations),
  );
