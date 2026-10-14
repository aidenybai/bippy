import { parseSync, traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import { compileFn } from "../react-compiler/Entrypoint/Pipeline";
import { compileProgram } from "../react-compiler/Entrypoint/Program";
import { ProgramContext } from "../react-compiler/Entrypoint/Imports";
import { parsePluginOptions } from "../react-compiler/Entrypoint/Options";
import type { CompilerPipelineValue } from "../react-compiler/Entrypoint/Pipeline";
import type { LoggerEvent, PluginOptions } from "../react-compiler/Entrypoint/Options";
import type { ReactFunctionType } from "../react-compiler/HIR/Environment";
import { isHookName } from "../react-compiler/HIR/Environment";
import type { HIRFunction, SourceLocation } from "../react-compiler/HIR/HIR";
import type { ModuleFunctionLoader } from "./function-registry";

type BabelFunction = NodePath<
  types.FunctionDeclaration | types.FunctionExpression | types.ArrowFunctionExpression
>;

export interface CompiledFunction {
  name: string;
  functionType: ReactFunctionType | null;
  loc: SourceLocation;
  hir: HIRFunction | null;
  errors: string[];
}

export interface CompiledFile {
  functions: CompiledFunction[];
  compileModuleFunction: ModuleFunctionLoader;
}

// HACK: later passes rewrite the HIR in place, so throw past the compiler to stop after STOP_PASS.
const STOP = Symbol("stop");
const STOP_PASS = "InferReactivePlaces";
const ANONYMOUS_NAME = "<anonymous>";
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

const getLocationKey = (loc: types.SourceLocation): string => `${loc.start.index}:${loc.end.index}`;

const describeEvent = (event: LoggerEvent): string | null => {
  switch (event.kind) {
    case "CompileError":
      return event.detail.reason;
    case "CompileSkip":
      return event.reason;
    case "PipelineError":
    case "CompileUnexpectedThrow":
      return event.data.split("\n")[0] ?? event.data;
    default:
      return null;
  }
};

const getFunctionName = (path: NodePath<types.Function>, code: string): string => {
  if (types.isFunctionDeclaration(path.node) && path.node.id) return path.node.id.name;
  const parent = path.parentPath?.node;
  if (types.isVariableDeclarator(parent) && types.isIdentifier(parent.id)) return parent.id.name;
  if (types.isAssignmentExpression(parent) && parent.right === path.node)
    return code.slice(parent.left.start ?? 0, parent.left.end ?? 0);
  if (types.isObjectProperty(parent) && types.isIdentifier(parent.key)) return parent.key.name;
  if (types.isAssignmentPattern(parent) && types.isIdentifier(parent.left)) return parent.left.name;
  const ancestor = path.findParent(
    (candidate) => !candidate.isCallExpression() && !candidate.isTSAsExpression(),
  );
  if (ancestor?.isVariableDeclarator() && types.isIdentifier(ancestor.node.id))
    return ancestor.node.id.name;
  if (ancestor?.isExportDefaultDeclaration()) return "default";
  return types.isFunctionExpression(path.node) && path.node.id ? path.node.id.name : ANONYMOUS_NAME;
};

const guessFunctionTypeFromName = (name: string): ReactFunctionType =>
  COMPONENT_NAME_PATTERN.test(name) ? "Component" : isHookName(name) ? "Hook" : "Other";

export const compileFile = (
  fileName: string,
  code: string,
  environment: PluginOptions["environment"] = {},
): CompiledFile => {
  const ast = parseSync(code, {
    filename: fileName,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: /\.[cm]?ts$/.test(fileName) ? ["typescript"] : ["typescript", "jsx"] },
  });
  if (!ast) return { functions: [], compileModuleFunction: () => null };

  const compiledByLocation = new Map<string, CompiledFunction>();
  const getCompiledFunction = (loc: types.SourceLocation): CompiledFunction => {
    const locationKey = getLocationKey(loc);
    const compiled = compiledByLocation.get(locationKey) ?? {
      name: ANONYMOUS_NAME,
      functionType: null,
      loc,
      hir: null,
      errors: [],
    };
    compiledByLocation.set(locationKey, compiled);
    return compiled;
  };
  const namesByLocation = new Map<string, string>();
  const moduleFunctionPaths = new Map<string, BabelFunction>();
  const pluginOptions = parsePluginOptions({
    compilationMode: "infer",
    outputMode: "lint",
    panicThreshold: "none",
    flowSuppressions: false,
    eslintSuppressionRules: [],
    environment,
    logger: {
      logEvent: (_fileName: string | null, event: LoggerEvent) => {
        if (!("fnLoc" in event) || !event.fnLoc) return;
        const compiled = getCompiledFunction(event.fnLoc);
        const errorReason = describeEvent(event);
        if (compiled.hir === null && errorReason && !errorReason.includes(STOP.toString()))
          compiled.errors.push(errorReason);
      },
      debugLogIRs: (pipelineValue: CompilerPipelineValue) => {
        if (pipelineValue.kind !== "hir") return;
        const hirFunction = pipelineValue.value;
        const { loc } = hirFunction;
        if (typeof loc === "symbol") return;
        if (pipelineValue.name === "HIR" && hirFunction.env.hasErrors()) {
          const compiled = getCompiledFunction(loc);
          compiled.functionType = hirFunction.fnType;
          compiled.errors.push(
            ...hirFunction.env.aggregateErrors().details.map((detail) => detail.reason),
          );
          throw STOP;
        }
        if (pipelineValue.name !== STOP_PASS) return;
        const compiled = getCompiledFunction(loc);
        compiled.functionType = hirFunction.fnType;
        compiled.hir = hirFunction;
        throw STOP;
      },
    },
  });

  let programPath: NodePath<types.Program> | null = null;
  traverse(ast, {
    Program(path) {
      programPath = path;
      compileProgram(path, {
        opts: pluginOptions,
        filename: fileName,
        comments: ast.comments ?? [],
        code,
      });
    },
    Function(path) {
      if (path.node.loc)
        namesByLocation.set(getLocationKey(path.node.loc), getFunctionName(path, code));
      if (
        path.parentPath.isProgram() ||
        (path.parentPath.isVariableDeclarator() &&
          path.parentPath.parentPath.parentPath?.isProgram())
      ) {
        if (
          path.isFunctionDeclaration() ||
          path.isFunctionExpression() ||
          path.isArrowFunctionExpression()
        )
          moduleFunctionPaths.set(getFunctionName(path, code), path);
      }
    },
  });
  for (const [locationKey, compiled] of compiledByLocation) {
    compiled.name = compiled.hir?.id ?? namesByLocation.get(locationKey) ?? ANONYMOUS_NAME;
    compiled.functionType ??= guessFunctionTypeFromName(compiled.name);
  }

  const moduleFunctionsByName = new Map<string, HIRFunction | null>();
  const compileModuleFunction = (functionName: string): HIRFunction | null => {
    if (moduleFunctionsByName.has(functionName))
      return moduleFunctionsByName.get(functionName) ?? null;
    const functionPath = moduleFunctionPaths.get(functionName);
    let hir: HIRFunction | null = null;
    if (functionPath && programPath) {
      const programContext = new ProgramContext({
        program: programPath,
        opts: pluginOptions,
        filename: fileName,
        code,
        suppressions: [],
        hasModuleScopeOptOut: false,
      });
      const logger = {
        logEvent: () => {},
        debugLogIRs: (pipelineValue: CompilerPipelineValue) => {
          if (pipelineValue.kind !== "hir") return;
          if (pipelineValue.name === "HIR" && pipelineValue.value.env.hasErrors()) throw STOP;
          if (pipelineValue.name !== STOP_PASS) return;
          hir = pipelineValue.value;
          throw STOP;
        },
      };
      try {
        compileFn(
          functionPath,
          pluginOptions.environment,
          "Other",
          "lint",
          programContext,
          logger,
          fileName,
          code,
        );
      } catch (error) {
        if (error !== STOP) hir = null;
      }
    }
    moduleFunctionsByName.set(functionName, hir);
    return hir;
  };

  return {
    functions: [...compiledByLocation.values()].filter(
      (compiled) => compiled.hir !== null || compiled.errors.length > 0,
    ),
    compileModuleFunction,
  };
};
