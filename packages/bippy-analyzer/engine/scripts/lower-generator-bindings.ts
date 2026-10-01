import type { NodePath, PluginAPI, PluginObject } from "@babel/core";
import transformBlockScoping, { type Options } from "@babel/plugin-transform-block-scoping";
import { EngineBuildError } from "../errors.js";

const isGeneratorScope = (path: NodePath): boolean => {
  const boundary = path.findParent((parent) => parent.isFunction() || parent.isStaticBlock());
  return boundary?.isFunction() === true && boundary.node.generator === true;
};

const assertSupportedDeclaration = (path: NodePath): void => {
  if (isGeneratorScope(path)) {
    if (path.isClassDeclaration())
      throw new EngineBuildError(
        "Generator-local class declarations are unsupported by control lowering",
      );
    if (path.isFunctionDeclaration() && !path.parentPath?.parentPath?.isFunction())
      throw new EngineBuildError(
        "Generator block-scoped function declarations are unsupported by control lowering",
      );
  }
  if (path.isClassDeclaration()) return;
  let hasNativeScope = false;
  for (let parent = path.parentPath; parent; parent = parent.parentPath) {
    if (parent.isFunction() && (parent.node.generator || !parent.isMethod())) {
      if (parent.node.generator && hasNativeScope)
        throw new EngineBuildError(
          "Generator lowering cannot preserve declarations in nested native methods or static blocks",
        );
      return;
    }
    if (parent.isMethod() || parent.isStaticBlock()) hasNativeScope = true;
  }
};

export const lowerGeneratorBindings = (
  api: PluginAPI,
  options: Options,
  directory: string,
): PluginObject => {
  const plugin = transformBlockScoping(api, options, directory);
  const loop = plugin.visitor && "Loop" in plugin.visitor ? plugin.visitor.Loop : undefined;
  const declaration = plugin.visitor?.VariableDeclaration;
  if (typeof loop !== "function" || typeof declaration !== "function")
    throw new EngineBuildError("Missing Babel block-scoping visitors");
  return {
    ...plugin,
    visitor: {
      Program(path) {
        path.traverse({
          VariableDeclaration: assertSupportedDeclaration,
          FunctionDeclaration: assertSupportedDeclaration,
          ClassDeclaration: assertSupportedDeclaration,
          Function(innerPath) {
            if (innerPath.node.async)
              throw new EngineBuildError(
                "Native async functions are unsupported by control lowering",
              );
          },
        });
      },
      Loop(path, state) {
        if (isGeneratorScope(path)) loop.call(state, path, state);
      },
      VariableDeclaration(path, state) {
        assertSupportedDeclaration(path);
        if (isGeneratorScope(path)) declaration.call(state, path, state);
      },
      FunctionDeclaration: assertSupportedDeclaration,
      ClassDeclaration: assertSupportedDeclaration,
    },
  };
};
