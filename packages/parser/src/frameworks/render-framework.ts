import path from "node:path";
import type { CorpusEntry } from "../corpus/manifest.js";
import { createStaticRenderer, type StaticRenderer } from "../render/static-renderer.js";
import type { StaticRenderResult, StaticRendererOptions } from "../types.js";
import type { FrameworkKind } from "./framework-profile.js";
import { renderNextAppRoute } from "./next-app-router.js";
import { createNextModel } from "./next-externals.js";
import { renderNextPagesRoute } from "./next-pages-router.js";
import { createReactRouterModel, renderReactRouterRoute } from "./react-router.js";

export interface FrameworkRenderTarget {
  framework: FrameworkKind;
  /** Entry module (SPA root, or the react-router routes/entry module); absolute or root-relative. */
  entry?: string;
  /** URL pathname to render for routed frameworks. */
  route?: string;
}

const requireField = (target: FrameworkRenderTarget, field: "entry" | "route"): string => {
  const value = target[field];
  if (value === undefined) {
    throw new Error(`${target.framework} static rendering needs a "${field}" target`);
  }
  return value;
};

/**
 * Renders one framework target statically. Next app-router targets always run
 * with server-component semantics because that is how Next renders `app/`.
 */
export const renderFrameworkTarget = (
  target: FrameworkRenderTarget,
  options: StaticRendererOptions,
): StaticRenderResult => {
  switch (target.framework) {
    case "spa":
      return createStaticRenderer(options).renderEntry(requireField(target, "entry"));
    case "next-app": {
      const route = requireField(target, "route");
      const model = createNextModel({ kind: "next-app", route });
      const renderer = createStaticRenderer({
        ...options,
        serverComponents: true,
        externalValues: model.externalValues,
      });
      return renderNextAppRoute(renderer, model, { route });
    }
    case "next-pages": {
      const route = requireField(target, "route");
      const model = createNextModel({ kind: "next-pages", route });
      const renderer = createStaticRenderer({ ...options, externalValues: model.externalValues });
      return renderNextPagesRoute(renderer, model, { route });
    }
    case "react-router": {
      const model = createReactRouterModel(requireField(target, "route"));
      const renderer = createStaticRenderer({ ...options, externalValues: model.externalValues });
      return renderReactRouterRoute(renderer, model, { routesModule: target.entry });
    }
  }
};

const rendererOptionsForEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
): StaticRendererOptions => {
  const rootDirectory = path.join(cloneDirectory, entry.static.rootDirectory);
  return {
    rootDirectory,
    tsconfigPath: path.join(rootDirectory, entry.static.tsconfig ?? "tsconfig.json"),
    externalPackageAllowList: entry.static.externalPackageAllowList,
    maxFiberCount: entry.static.maxFiberCount,
    maxComponentDepth: entry.static.maxComponentDepth,
  };
};

export const createRendererForEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
): StaticRenderer => createStaticRenderer(rendererOptionsForEntry(entry, cloneDirectory));

export const renderFramework = (entry: CorpusEntry, cloneDirectory: string): StaticRenderResult =>
  renderFrameworkTarget(
    { framework: entry.framework, entry: entry.static.entry, route: entry.static.route },
    rendererOptionsForEntry(entry, cloneDirectory),
  );
