import path from "node:path";
import { getSettleMs, type CorpusEntry } from "../corpus/manifest.js";
import { readProcessEnvironment } from "../corpus/process-environment.js";
import { FrameworkTargetError } from "../errors.js";
import { createStaticRenderer, type StaticRenderer } from "../render/static-renderer.js";
import type {
  PinnedDecisions,
  RuntimeObservations,
  StaticRenderResult,
  StaticRendererOptions,
} from "../types.js";
import type { FrameworkKind } from "./framework-profile.js";
import { renderNextAppRoute } from "./next-app-router.js";
import { readInstalledVersion } from "../libraries/installed-version.js";
import { createNextModel } from "./next-externals.js";
import { renderNextPagesRoute } from "./next-pages-router.js";
import {
  createReactRouterModel,
  renderReactRouterRoute,
  type ReactRouterModel,
} from "./react-router.js";

export interface FrameworkRenderTarget {
  framework: FrameworkKind;
  /** Entry module (SPA root, or the react-router routes/entry module); absolute or root-relative. */
  entry?: string;
  /** Page route (pathname, query and fragment) the browser is at; routed frameworks render it. */
  route?: string;
  /** The `app/` (or Next `pages/`) directory when it is not directly under the renderer root. */
  appDirectory?: string;
  /**
   * Export of `entry` that the boot code mounts when it does not pass a literal
   * element to the root render call (`renderDom(Main, ...)`).
   */
  rootComponent?: string;
}

const requireField = (target: FrameworkRenderTarget, field: "entry" | "route"): string => {
  const value = target[field];
  if (value === undefined) {
    throw new FrameworkTargetError(
      `${target.framework} static rendering needs a "${field}" target`,
    );
  }
  return value;
};

/** Renders one target as often as asked, each time with a fresh interpreter over one parsed project. */
export interface FrameworkRenderer {
  render(decisions?: PinnedDecisions): Promise<StaticRenderResult>;
}

/**
 * Prepares one framework target for static rendering. Next app-router targets
 * always run with server-component semantics because that is how Next renders
 * `app/`. Framework models are built per render, so nothing they hold survives
 * from one render into the next.
 */
export const createFrameworkRenderer = (
  target: FrameworkRenderTarget,
  rendererOptions: StaticRendererOptions,
): FrameworkRenderer => {
  const renderer = createStaticRenderer({
    ...rendererOptions,
    route: target.route,
    serverComponents: target.framework === "next-app" ? true : rendererOptions.serverComponents,
  });
  return {
    render: (decisions) => {
      const pinned = renderer.derive({ decisions });
      return target.rootComponent === undefined
        ? renderTarget(target, pinned)
        : renderRootComponent(target, pinned);
    },
  };
};

export const renderFrameworkTarget = (
  target: FrameworkRenderTarget,
  rendererOptions: StaticRendererOptions,
): Promise<StaticRenderResult> => createFrameworkRenderer(target, rendererOptions).render();

interface RoutedRenderer {
  renderer: StaticRenderer;
  model: ReactRouterModel;
}

const createReactRouterRenderer = (
  target: FrameworkRenderTarget,
  renderer: StaticRenderer,
): RoutedRenderer => {
  const { options } = renderer;
  const model = createReactRouterModel(
    requireField(target, "route"),
    options.rootDirectory,
    options.observations?.router ?? null,
  );
  return { renderer: renderer.derive({ externalValues: model.externalValues }), model };
};

const renderTarget = (
  target: FrameworkRenderTarget,
  renderer: StaticRenderer,
): Promise<StaticRenderResult> => {
  const { options } = renderer;
  switch (target.framework) {
    case "spa":
      return renderer.renderEntry(requireField(target, "entry"));
    case "next-app": {
      const route = requireField(target, "route");
      const model = createNextModel({
        kind: "next-app",
        route,
        origin: options.origin,
        request: options.observations?.request,
        version: readInstalledVersion(options.rootDirectory, "next"),
        nextIntlVersion: readInstalledVersion(options.rootDirectory, "next-intl"),
      });
      return renderNextAppRoute(renderer.derive({ externalValues: model.externalValues }), model, {
        route,
        appDirectory: target.appDirectory,
      });
    }
    case "next-pages": {
      const route = requireField(target, "route");
      const model = createNextModel({
        kind: "next-pages",
        route,
        origin: options.origin,
        version: readInstalledVersion(options.rootDirectory, "next"),
        nextIntlVersion: readInstalledVersion(options.rootDirectory, "next-intl"),
      });
      return renderNextPagesRoute(
        renderer.derive({ externalValues: model.externalValues }),
        model,
        {
          route,
          pagesDirectory: target.appDirectory,
        },
      );
    }
    case "react-router": {
      const routed = createReactRouterRenderer(target, renderer);
      return renderReactRouterRoute(routed.renderer, routed.model, {
        routesModule: target.entry,
        appDirectory: target.appDirectory,
      });
    }
  }
};

const renderRootComponent = (
  target: FrameworkRenderTarget,
  renderer: StaticRenderer,
): Promise<StaticRenderResult> => {
  const entry = requireField(target, "entry");
  const exportName = target.rootComponent;
  switch (target.framework) {
    case "spa":
      return renderer.renderComponent(entry, { exportName });
    case "react-router":
      return createReactRouterRenderer(target, renderer).renderer.renderComponent(entry, {
        exportName,
      });
    case "next-app":
    case "next-pages":
      throw new FrameworkTargetError(
        `${target.framework} targets render routes, not a "rootComponent"`,
      );
  }
};

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

export const createRendererForEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
): StaticRenderer => createStaticRenderer(rendererOptionsForEntry(entry, cloneDirectory));

export const createFrameworkRendererForEntry = (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): FrameworkRenderer =>
  createFrameworkRenderer(
    {
      framework: entry.framework,
      entry: entry.static.entry,
      route: entry.static.route ?? getPageRoute(entry.url),
      appDirectory: entry.static.appDirectory,
      rootComponent: entry.static.rootComponent,
    },
    rendererOptionsForEntry(entry, cloneDirectory, observations),
  );

export const renderFramework = (
  entry: CorpusEntry,
  cloneDirectory: string,
  observations?: RuntimeObservations,
): Promise<StaticRenderResult> =>
  createFrameworkRendererForEntry(entry, cloneDirectory, observations).render();
