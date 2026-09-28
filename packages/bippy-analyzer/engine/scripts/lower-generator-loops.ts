import type { PluginAPI, PluginObject } from "@babel/core";
import transformForOf, { type Options } from "@babel/plugin-transform-for-of";
import { EngineBuildError } from "../errors.js";

export const lowerGeneratorLoops = (
  api: PluginAPI,
  options: Options,
  directory: string,
): PluginObject => {
  const plugin = transformForOf(api, options, directory);
  const visit = plugin.visitor?.ForOfStatement;
  if (typeof visit !== "function") throw new EngineBuildError("Missing Babel for-of visitor");
  return {
    ...plugin,
    visitor: {
      ForOfStatement(path, state) {
        if (!path.getFunctionParent()?.node.generator) return;
        visit.call(state, path, state);
      },
    },
  };
};
