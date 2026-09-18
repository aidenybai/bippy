import path from "node:path";
import { createFrameworkRenderer, type FrameworkRenderer } from "../frameworks/render-framework.js";
import type { StaticRenderResult, StaticRendererOptions } from "../render/types.js";
import type { RuntimeObservations } from "../types.js";
import { getDevServerEnvironment } from "./dev-server.js";
import { getSettleMs, type CorpusEntry } from "./manifest.js";
import { readProcessEnvironment, runWithProcessEnvironment } from "./process-environment.js";

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
    defines: {
      ...observations?.compilerDefines,
      ...entry.static.defines,
    },
    svgr: entry.static.svgr,
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

export const createCorpusEntryRenderer = (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): Promise<FrameworkRenderer> =>
  runWithProcessEnvironment(
    () => getDevServerEnvironment(entry.env),
    async (environment) => {
      const renderer = await createFrameworkRenderer(
        {
          framework: entry.framework,
          entry: entry.static.entry,
          route: entry.static.route ?? getPageRoute(entry.url),
          appDirectory: entry.static.appDirectory,
          rootComponent: entry.static.rootComponent,
        },
        rendererOptionsForEntry(entry, cloneDirectory, observations),
      );
      return {
        render: (decisions) =>
          runWithProcessEnvironment(
            () => environment,
            () => renderer.render(decisions),
          ),
      };
    },
  );

export const renderCorpusEntry = async (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): Promise<StaticRenderResult> =>
  (await createCorpusEntryRenderer(entry, cloneDirectory, observations)).render();
