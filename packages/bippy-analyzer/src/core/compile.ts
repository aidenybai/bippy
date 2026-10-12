import { parseSync, traverse, types as t } from "@babel/core";
import type { NodePath } from "@babel/core";
import { compileFn } from "../react-compiler/Entrypoint/Pipeline.js";
import { compileProgram } from "../react-compiler/Entrypoint/Program.js";
import { ProgramContext } from "../react-compiler/Entrypoint/Imports.js";
import { parsePluginOptions } from "../react-compiler/Entrypoint/Options.js";
import type { CompilerPipelineValue } from "../react-compiler/Entrypoint/Pipeline.js";
import type { LoggerEvent, PluginOptions } from "../react-compiler/Entrypoint/Options.js";
import type { ReactFunctionType } from "../react-compiler/HIR/Environment.js";
import { isHookName } from "../react-compiler/HIR/Environment.js";
import type { HIRFunction, SourceLocation } from "../react-compiler/HIR/HIR.js";

type BabelFunction = NodePath<
  t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression
>;

export interface CompiledFunction {
  name: string;
  fnType: ReactFunctionType | null;
  loc: SourceLocation;
  hir: HIRFunction | null;
  errors: string[];
}

export interface CompiledFile {
  functions: CompiledFunction[];
  compileModuleFunction: (name: string) => HIRFunction | null;
}

// HACK: later passes rewrite the HIR in place, so throw past the compiler to stop after STOP_PASS.
const STOP = Symbol("stop");
const STOP_PASS = "InferReactivePlaces";
const ANONYMOUS_NAME = "<anonymous>";
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

const getLocationKey = (loc: t.SourceLocation): string => `${loc.start.index}:${loc.end.index}`;

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

const getFunctionName = (path: NodePath<t.Function>, code: string): string => {
  if (t.isFunctionDeclaration(path.node) && path.node.id) return path.node.id.name;
  const parent = path.parentPath?.node;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
  if (t.isAssignmentExpression(parent) && parent.right === path.node)
    return code.slice(parent.left.start ?? 0, parent.left.end ?? 0);
  if (t.isObjectProperty(parent) && t.isIdentifier(parent.key)) return parent.key.name;
  if (t.isAssignmentPattern(parent) && t.isIdentifier(parent.left)) return parent.left.name;
  const ancestor = path.findParent(
    (candidate) => !candidate.isCallExpression() && !candidate.isTSAsExpression(),
  );
  if (ancestor?.isVariableDeclarator() && t.isIdentifier(ancestor.node.id))
    return ancestor.node.id.name;
  if (ancestor?.isExportDefaultDeclaration()) return "default";
  return t.isFunctionExpression(path.node) && path.node.id ? path.node.id.name : ANONYMOUS_NAME;
};

// A function that fails before lowering never reports its type, so infer it from the name.
const getFunctionType = (name: string): ReactFunctionType =>
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

  const functions = new Map<string, CompiledFunction>();
  const getFunction = (loc: t.SourceLocation): CompiledFunction => {
    const key = getLocationKey(loc);
    const compiled = functions.get(key) ?? {
      name: ANONYMOUS_NAME,
      fnType: null,
      loc,
      hir: null,
      errors: [],
    };
    functions.set(key, compiled);
    return compiled;
  };
  const names = new Map<string, string>();
  const modulePaths = new Map<string, BabelFunction>();
  const opts = parsePluginOptions({
    compilationMode: "infer",
    outputMode: "lint",
    panicThreshold: "none",
    flowSuppressions: false,
    eslintSuppressionRules: [],
    environment,
    logger: {
      logEvent: (_fileName: string | null, event: LoggerEvent) => {
        if (!("fnLoc" in event) || !event.fnLoc) return;
        const compiled = getFunction(event.fnLoc);
        const description = describeEvent(event);
        if (compiled.hir === null && description && !description.includes(STOP.toString()))
          compiled.errors.push(description);
      },
      debugLogIRs: (value: CompilerPipelineValue) => {
        if (value.kind !== "hir") return;
        const fn = value.value;
        const loc = fn.loc;
        if (typeof loc === "symbol") return;
        if (value.name === "HIR" && fn.env.hasErrors()) {
          const compiled = getFunction(loc);
          compiled.fnType = fn.fnType;
          compiled.errors.push(...fn.env.aggregateErrors().details.map((detail) => detail.reason));
          throw STOP;
        }
        if (value.name !== STOP_PASS) return;
        const compiled = getFunction(loc);
        compiled.fnType = fn.fnType;
        compiled.hir = fn;
        throw STOP;
      },
    },
  });

  let programPath: NodePath<t.Program> | null = null;
  traverse(ast, {
    Program(path) {
      programPath = path;
      compileProgram(path, { opts, filename: fileName, comments: ast.comments ?? [], code });
    },
    Function(path) {
      if (path.node.loc) names.set(getLocationKey(path.node.loc), getFunctionName(path, code));
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
          modulePaths.set(getFunctionName(path, code), path);
      }
    },
  });
  for (const [key, compiled] of functions) {
    compiled.name = compiled.hir?.id ?? names.get(key) ?? ANONYMOUS_NAME;
    compiled.fnType ??= getFunctionType(compiled.name);
  }

  const moduleFunctions = new Map<string, HIRFunction | null>();
  const compileModuleFunction = (name: string): HIRFunction | null => {
    if (moduleFunctions.has(name)) return moduleFunctions.get(name) ?? null;
    const path = modulePaths.get(name);
    let hir: HIRFunction | null = null;
    if (path && programPath) {
      const programContext = new ProgramContext({
        program: programPath,
        opts,
        filename: fileName,
        code,
        suppressions: [],
        hasModuleScopeOptOut: false,
      });
      const logger = {
        logEvent: () => {},
        debugLogIRs: (value: CompilerPipelineValue) => {
          if (value.kind !== "hir") return;
          if (value.name === "HIR" && value.value.env.hasErrors()) throw STOP;
          if (value.name !== STOP_PASS) return;
          hir = value.value;
          throw STOP;
        },
      };
      try {
        compileFn(path, opts.environment, "Other", "lint", programContext, logger, fileName, code);
      } catch (error) {
        if (error !== STOP) hir = null;
      }
    }
    moduleFunctions.set(name, hir);
    return hir;
  };

  return {
    functions: [...functions.values()].filter(
      (compiled) => compiled.hir !== null || compiled.errors.length > 0,
    ),
    compileModuleFunction,
  };
};
