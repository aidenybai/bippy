import { transformAsync, type PluginObj } from "@babel/core";
import { getCaptureManifest } from "./capture-manifest.js";
import { nativeCaptures } from "./native-captures.js";
import * as syntax from "@babel/types";
import { resolve } from "node:path";

const runtimePath = resolve(import.meta.dirname, "../src/execution-machine.ts");

const machineHelpers = (): PluginObj => {
  let helperIdentifier: syntax.Identifier | undefined;
  let isUsed = false;
  return {
    visitor: {},
    pre: (file) => {
      const identifier = file.scope.generateUidIdentifier("executionMachine");
      helperIdentifier = identifier;
      const set: unknown = Reflect.get(file, "set");
      if (typeof set !== "function") throw new Error("Missing Babel helper hook");
      Reflect.apply(set, file, [
        "helperGenerator",
        (name: string) => {
          if (name !== "regenerator") return undefined;
          isUsed = true;
          return syntax.cloneNode(identifier);
        },
      ]);
    },
    post: (file) => {
      const identifier = helperIdentifier;
      if (!isUsed || !identifier) return;
      file.path.unshiftContainer(
        "body",
        syntax.importDeclaration(
          [syntax.importSpecifier(identifier, syntax.identifier("executionMachine"))],
          syntax.stringLiteral(runtimePath),
        ),
      );
      file.path.scope.crawl();
      file.path.traverse({
        CallExpression: (callPath) => {
          const callee = callPath.node.callee;
          if (
            !syntax.isMemberExpression(callee) ||
            !syntax.isIdentifier(callee.property, { name: "w" }) ||
            !syntax.isCallExpression(callee.object) ||
            !syntax.isIdentifier(callee.object.callee, { name: identifier.name })
          )
            return;
          const argumentsPaths = callPath.get("arguments");
          const emitterPath = argumentsPaths[0];
          if (!emitterPath?.isFunctionExpression()) throw new Error("Missing machine emitter");
          const contextIdentifier = emitterPath.node.params[0];
          if (!syntax.isIdentifier(contextIdentifier))
            throw new Error("Missing machine context parameter");
          const activation = callPath.getFunctionParent();
          if (!activation) throw new Error("Missing machine activation");
          const bindings = new Set(Object.values(activation.scope.bindings));
          const names = new Set<string>();
          emitterPath.traverse({
            Identifier: (referencePath) => {
              if (
                !syntax.isReferenced(
                  referencePath.node,
                  referencePath.parent,
                  referencePath.parentPath?.parent,
                ) &&
                !syntax.isBinding(
                  referencePath.node,
                  referencePath.parent,
                  referencePath.parentPath?.parent,
                )
              )
                return;
              const binding = referencePath.scope.getBinding(referencePath.node.name);
              if (!binding || !bindings.has(binding)) return;
              names.add(binding.identifier.name);
              referencePath.replaceWith(
                syntax.memberExpression(
                  syntax.memberExpression(
                    syntax.cloneNode(contextIdentifier),
                    syntax.identifier("l"),
                  ),
                  syntax.identifier(referencePath.node.name),
                ),
              );
              referencePath.skip();
            },
          });
          const captures = getCaptureManifest(emitterPath);
          while (callPath.node.arguments.length < 4)
            callPath.node.arguments.push(syntax.nullLiteral());
          callPath.node.arguments.push(
            syntax.objectExpression(
              [...names].map((name) =>
                syntax.objectProperty(
                  syntax.identifier(name),
                  syntax.identifier(name),
                  false,
                  true,
                ),
              ),
            ),
          );
          callPath.node.arguments.push(syntax.arrowFunctionExpression([], captures));
        },
      });
    },
  };
};

export const lowerGenerators = async (source: string, filename: string): Promise<string> => {
  const result = await transformAsync(source, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: "inline",
    plugins: [
      machineHelpers,
      "@babel/plugin-transform-parameters",
      "@babel/plugin-transform-destructuring",
      "@babel/plugin-transform-for-of",
      "@babel/plugin-transform-block-scoping",
      "@babel/plugin-transform-regenerator",
    ],
  });
  if (!result?.code) throw new Error(`No machine lowering output for ${filename}`);
  const captured = await transformAsync(result.code, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: "inline",
    plugins: [nativeCaptures],
  });
  if (!captured?.code) throw new Error(`No native capture output for ${filename}`);
  return captured.code;
};
