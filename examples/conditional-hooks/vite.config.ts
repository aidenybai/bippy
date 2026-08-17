import type { PluginObj, PluginPass } from "@babel/core";
import * as babelTypes from "@babel/types";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

interface ConditionalHooksPluginState extends PluginPass {
  didTransformComponent: boolean;
}

const isComponentName = (name: string): boolean => /^[A-Z]/.test(name);

const isComponentWrapper = (expression: babelTypes.Expression): boolean => {
  if (babelTypes.isIdentifier(expression)) {
    return expression.name === "memo" || expression.name === "forwardRef";
  }
  return (
    babelTypes.isMemberExpression(expression) &&
    babelTypes.isIdentifier(expression.property) &&
    (expression.property.name === "memo" || expression.property.name === "forwardRef")
  );
};

const getComponentFunction = (
  expression: babelTypes.Expression | null | undefined,
): babelTypes.ArrowFunctionExpression | babelTypes.FunctionExpression | undefined => {
  if (
    babelTypes.isArrowFunctionExpression(expression) ||
    babelTypes.isFunctionExpression(expression)
  ) {
    return expression;
  }
  if (
    !babelTypes.isCallExpression(expression) ||
    !babelTypes.isExpression(expression.callee) ||
    !isComponentWrapper(expression.callee)
  ) {
    return undefined;
  }
  const component = expression.arguments[0];
  return babelTypes.isExpression(component) ? getComponentFunction(component) : undefined;
};

const injectConditionalHooks = (
  functionNode:
    | babelTypes.ArrowFunctionExpression
    | babelTypes.FunctionDeclaration
    | babelTypes.FunctionExpression,
): void => {
  const initializeHooks = babelTypes.expressionStatement(
    babelTypes.callExpression(babelTypes.identifier("__useConditionalHooks"), []),
  );
  if (babelTypes.isBlockStatement(functionNode.body)) {
    functionNode.body.body.unshift(initializeHooks);
    return;
  }
  functionNode.body = babelTypes.blockStatement([
    initializeHooks,
    babelTypes.returnStatement(functionNode.body),
  ]);
};

const conditionalHooksPlugin = (): PluginObj<ConditionalHooksPluginState> => ({
  name: "conditional-hooks",
  pre() {
    this.didTransformComponent = false;
  },
  visitor: {
    FunctionDeclaration(path, state) {
      const name = path.node.id?.name;
      if (!name || !isComponentName(name)) return;
      injectConditionalHooks(path.node);
      state.didTransformComponent = true;
    },
    VariableDeclarator(path, state) {
      if (!babelTypes.isIdentifier(path.node.id) || !isComponentName(path.node.id.name)) return;
      const componentFunction = getComponentFunction(path.node.init);
      if (!componentFunction) return;
      injectConditionalHooks(componentFunction);
      state.didTransformComponent = true;
    },
    ExportDefaultDeclaration(path, state) {
      const declaration = path.node.declaration;
      if (
        !babelTypes.isArrowFunctionExpression(declaration) &&
        !babelTypes.isFunctionDeclaration(declaration) &&
        !babelTypes.isFunctionExpression(declaration)
      ) {
        return;
      }
      if (babelTypes.isFunctionDeclaration(declaration) && declaration.id) return;
      injectConditionalHooks(declaration);
      state.didTransformComponent = true;
    },
    Program: {
      exit(path, state) {
        if (!state.didTransformComponent) return;
        path.node.body.unshift(
          babelTypes.importDeclaration(
            [
              babelTypes.importSpecifier(
                babelTypes.identifier("__useConditionalHooks"),
                babelTypes.identifier("useConditionalHooks"),
              ),
            ],
            babelTypes.stringLiteral("/src/conditional-hooks"),
          ),
        );
      },
    },
  },
});

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [conditionalHooksPlugin],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: "bippy/install-hook-only",
        replacement: fileURLToPath(
          new URL("../../packages/bippy/src/install-hook-only.ts", import.meta.url),
        ),
      },
      {
        find: "bippy",
        replacement: fileURLToPath(new URL("../../packages/bippy/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "happy-dom",
  },
});
