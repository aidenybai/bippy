import type { CreateElementRewrite } from "../types.js";

/**
 * `react-native-css-interop/dist/babel-plugin` (`name: "react-native-css-interop-imports"`):
 * in every file outside React's own packages it replaces `React.createElement`
 * and `createElement` imported from `react` with the package's
 * `createInteropElement`, which swaps registered components for their
 * `CssInterop.*` wrappers before calling React.
 */
const CSS_INTEROP_REWRITE: CreateElementRewrite = {
  filePattern: /^(?!.*[/\\](react|react-native|react-native-web|react-native-css-interop)[/\\]).*$/,
  moduleSpecifier: "react-native-css-interop",
  exportName: "createInteropElement",
};

const CREATE_ELEMENT_REWRITES_BY_PLUGIN: Record<string, CreateElementRewrite> = {
  "react-native-css-interop-imports": CSS_INTEROP_REWRITE,
};

/** The `createElement` rewrites the Babel plugins in a resolved config perform, by their `name`. */
export const getCreateElementRewrites = (pluginNames: readonly string[]): CreateElementRewrite[] =>
  pluginNames.flatMap((pluginName) => {
    const rewrite = CREATE_ELEMENT_REWRITES_BY_PLUGIN[pluginName];
    return rewrite === undefined ? [] : [rewrite];
  });
