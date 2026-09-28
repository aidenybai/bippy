import { transformAsync, type PluginObject, type FileResult } from "@babel/core";
import { getCaptureManifest } from "./capture-manifest.js";
import { nativeCaptures } from "./native-captures.js";
import * as syntax from "@babel/types";
import { createRequire } from "node:module";
import { controlSpecifier } from "./control-paths.js";
import { EngineBuildError } from "../errors.js";
import { getInputSourceMap } from "./get-input-source-map.js";
import { lowerGeneratorLoops } from "./lower-generator-loops.js";

const require = createRequire(import.meta.url);

const machineHelpers = (): PluginObject => {
  let helperIdentifier: syntax.Identifier | undefined;
  let iteratorIdentifier: syntax.Identifier | undefined;
  let isUsed = false;
  let isIteratorUsed = false;
  return {
    visitor: {},
    pre: (file) => {
      const identifier = file.scope.generateUidIdentifier("executionMachine");
      helperIdentifier = identifier;
      const iterator = file.scope.generateUidIdentifier("getControlIterator");
      iteratorIdentifier = iterator;
      const set: unknown = Reflect.get(file, "set");
      if (typeof set !== "function") throw new Error("Missing Babel helper hook");
      Reflect.apply(set, file, [
        "helperGenerator",
        (name: string) => {
          if (name === "regeneratorValues") {
            isIteratorUsed = true;
            return syntax.cloneNode(iterator);
          }
          if (name !== "regenerator") return undefined;
          isUsed = true;
          return syntax.cloneNode(identifier);
        },
      ]);
    },
    post: (file) => {
      const identifier = helperIdentifier;
      if (!isUsed || !identifier) return;
      const imports = [syntax.importSpecifier(identifier, syntax.identifier("executionMachine"))];
      if (isIteratorUsed && iteratorIdentifier)
        imports.push(
          syntax.importSpecifier(iteratorIdentifier, syntax.identifier("getControlIterator")),
        );
      file.path.unshiftContainer(
        "body",
        syntax.importDeclaration(imports, syntax.stringLiteral(controlSpecifier)),
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

export const lowerGenerators = async (
  source: string,
  filename: string,
  inputSourceMap?: NonNullable<FileResult["map"]>,
) => {
  const result = await transformAsync(source, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: true,
    inputSourceMap: inputSourceMap ? getInputSourceMap(inputSourceMap, filename) : undefined,
    plugins: [
      machineHelpers,
      require.resolve("@babel/plugin-transform-parameters"),
      require.resolve("@babel/plugin-transform-destructuring"),
      lowerGeneratorLoops,
      require.resolve("@babel/plugin-transform-block-scoping"),
      require.resolve("@babel/plugin-transform-regenerator"),
    ],
  });
  if (!result?.code || !result.map)
    throw new EngineBuildError(`No machine lowering output for ${filename}`);
  const captured = await transformAsync(result.code, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: true,
    inputSourceMap: getInputSourceMap(result.map, filename),
    plugins: [nativeCaptures],
  });
  if (!captured?.code || !captured.map)
    throw new EngineBuildError(`No native capture output for ${filename}`);
  return { code: captured.code, map: captured.map };
};
