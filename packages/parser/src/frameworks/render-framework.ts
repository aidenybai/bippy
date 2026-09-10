import { FrameworkTargetError } from "../errors.js";
import { createStaticRenderer } from "../render/static-renderer.js";
import type { StaticRenderResult, StaticRendererOptions } from "../types.js";
import type { FrameworkKind } from "./framework-profile.js";
import { renderNextAppRoute } from "./next-app-router.js";
import { readInstalledVersion } from "../libraries/installed-version.js";
import { createNextModel } from "./next-externals.js";
import { renderNextPagesRoute } from "./next-pages-router.js";
import { createReactRouterModel, renderReactRouterRoute } from "./react-router.js";

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

/**
 * Renders one framework target statically. Next app-router targets always run
 * with server-component semantics because that is how Next renders `app/`.
 */
export const renderFrameworkTarget = (
  target: FrameworkRenderTarget,
  rendererOptions: StaticRendererOptions,
): Promise<StaticRenderResult> => {
  const options: StaticRendererOptions = { ...rendererOptions, route: target.route };
  if (target.rootComponent !== undefined) return renderRootComponent(target, options);
  switch (target.framework) {
    case "spa":
      return createStaticRenderer(options).renderEntry(requireField(target, "entry"));
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
      const renderer = createStaticRenderer({
        ...options,
        serverComponents: true,
        externalValues: model.externalValues,
      });
      return renderNextAppRoute(renderer, model, { route, appDirectory: target.appDirectory });
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
      const renderer = createStaticRenderer({ ...options, externalValues: model.externalValues });
      return renderNextPagesRoute(renderer, model, {
        route,
        pagesDirectory: target.appDirectory,
      });
    }
    case "react-router": {
      const model = createReactRouterModel(
        requireField(target, "route"),
        options.rootDirectory,
        options.observations?.router ?? null,
      );
      const renderer = createStaticRenderer({ ...options, externalValues: model.externalValues });
      return renderReactRouterRoute(renderer, model, {
        routesModule: target.entry,
        appDirectory: target.appDirectory,
      });
    }
  }
};

const renderRootComponent = (
  target: FrameworkRenderTarget,
  options: StaticRendererOptions,
): Promise<StaticRenderResult> => {
  const entry = requireField(target, "entry");
  const exportName = target.rootComponent;
  switch (target.framework) {
    case "spa":
      return createStaticRenderer(options).renderComponent(entry, { exportName });
    case "react-router": {
      const model = createReactRouterModel(
        requireField(target, "route"),
        options.rootDirectory,
        options.observations?.router ?? null,
      );
      const renderer = createStaticRenderer({ ...options, externalValues: model.externalValues });
      return renderer.renderComponent(entry, { exportName });
    }
    case "next-app":
    case "next-pages":
      throw new FrameworkTargetError(
        `${target.framework} targets render routes, not a "rootComponent"`,
      );
  }
};
