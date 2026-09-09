import { existsSync } from "node:fs";
import path from "node:path";
import { readPackageManifest } from "../package-manifest.js";
import type { ProcessEnvironment } from "../types.js";

export const REACT_SCRIPTS_PACKAGE = "react-scripts";

const REACT_APP_VARIABLE = /^REACT_APP_/i;
const STUB_DOMAIN = "https://create-react-app.dev";

/** `react-dev-utils/getPublicUrlOrPath` in development: `PUBLIC_URL` over the manifest `homepage`, always an absolute path ending in `/`. */
const getPublicUrlOrPath = (homepage: string | undefined, envPublicUrl: string | undefined): string => {
  const source = envPublicUrl || homepage;
  if (!source) return "/";
  const withTrailingSlash = source.endsWith("/") ? source : `${source}/`;
  return withTrailingSlash.startsWith(".") ? "/" : new URL(withTrailingSlash, STUB_DOMAIN).pathname;
};

/**
 * `getClientEnvironment(publicUrl).raw` of `react-scripts/config/env.js` under
 * `react-scripts start`: the variables its `DefinePlugin` inlines as
 * `process.env.<NAME>` and `InterpolateHtmlPlugin` substitutes for `%NAME%` in
 * `public/index.html`.
 */
export const getReactScriptsClientEnvironment = (
  rootDirectory: string,
  environment: ProcessEnvironment | null,
): Record<string, string | boolean | undefined> => {
  const variables = environment?.variables ?? {};
  const manifestPath = path.join(rootDirectory, "package.json");
  const homepage = existsSync(manifestPath) ? readPackageManifest(manifestPath).homepage : undefined;
  const clientEnvironment: Record<string, string | boolean | undefined> = {
    NODE_ENV: "development",
    PUBLIC_URL: getPublicUrlOrPath(homepage, variables.PUBLIC_URL).slice(0, -1),
    WDS_SOCKET_HOST: variables.WDS_SOCKET_HOST,
    WDS_SOCKET_PATH: variables.WDS_SOCKET_PATH,
    WDS_SOCKET_PORT: variables.WDS_SOCKET_PORT,
    FAST_REFRESH: variables.FAST_REFRESH !== "false",
  };
  for (const [name, value] of Object.entries(variables)) {
    if (REACT_APP_VARIABLE.test(name)) clientEnvironment[name] = value;
  }
  return clientEnvironment;
};
