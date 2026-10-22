import { getModuleType } from "./utils/get-module-type";
import { parseSync, traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import { compileFn } from "../react-compiler/Entrypoint/Pipeline";
import { compileProgram } from "../react-compiler/Entrypoint/Program";
import { ProgramContext } from "../react-compiler/Entrypoint/Imports";
import { parsePluginOptions } from "../react-compiler/Entrypoint/Options";
import type { CompilerPipelineValue } from "../react-compiler/Entrypoint/Pipeline";
import type {
  LoggerEvent,
  ParsedPluginOptions,
  PluginOptions,
} from "../react-compiler/Entrypoint/Options";
import type { ReactFunctionType } from "../react-compiler/HIR/Environment";
import { isHookName } from "../react-compiler/HIR/Environment";
import type { HIRFunction, SourceLocation } from "../react-compiler/HIR/HIR";
import type { ModuleFunctionLoader } from "./function-registry";
import { createModuleConstantLoader, createModuleVariableLoader } from "./module-constants";
import type { ModuleConstantLoader, ModuleVariableLoader } from "./module-constants";
import { getLocationKey } from "./utils/get-location-key";

type BabelFunction = NodePath<
  types.FunctionDeclaration | types.FunctionExpression | types.ArrowFunctionExpression
>;

export interface CompiledFunction {
  name: string;
  bindingName: string;
  functionType: ReactFunctionType | null;
  loc: SourceLocation;
  hir: HIRFunction | null;
  errors: string[];
  isClass: boolean;
}

export interface CompiledFile {
  functions: CompiledFunction[];
  loadModuleFunction: ModuleFunctionLoader;
  lowerModuleFunction: ModuleFunctionLoader;
  loadModuleConstant: ModuleConstantLoader;
  loadModuleVariable: ModuleVariableLoader;
}

const STOP = Symbol("stop");
const STOP_PASS = "InferReactivePlaces";
const ANONYMOUS_NAME = "<anonymous>";
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

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

interface LoweringCapture {
  (hirFunction: HIRFunction, hasErrors: boolean): boolean;
}

interface ProgramFunctions {
  programPath: NodePath<types.Program> | null;
  namesByLocation: Map<string, string>;
  moduleFunctionPaths: Map<string, BabelFunction>;
}

const EMPTY_COMPILED_FILE: CompiledFile = {
  functions: [],
  loadModuleFunction: () => null,
  lowerModuleFunction: () => null,
  loadModuleConstant: () => null,
  loadModuleVariable: () => null,
};

const COMPONENT_BASE_CLASSES = new Set(["Component", "PureComponent"]);

const isComponentBaseClass = (superClass: types.Expression | null | undefined): boolean => {
  if (types.isIdentifier(superClass)) return COMPONENT_BASE_CLASSES.has(superClass.name);
  return (
    types.isMemberExpression(superClass) &&
    types.isIdentifier(superClass.property) &&
    COMPONENT_BASE_CLASSES.has(superClass.property.name)
  );
};

const getClassName = (path: NodePath<types.Class>): string | null => {
  if (path.node.id) return path.node.id.name;
  const { parent } = path;
  return types.isVariableDeclarator(parent) && types.isIdentifier(parent.id)
    ? parent.id.name
    : null;
};

const collectClassComponents = (ast: types.File): CompiledFunction[] => {
  const classComponents: CompiledFunction[] = [];
  traverse(ast, {
    Class(path) {
      const name = getClassName(path);
      const { loc } = path.node;
      if (!name || !loc || !isComponentBaseClass(path.node.superClass)) return;
      classComponents.push({
        name,
        bindingName: name,
        functionType: "Component",
        loc,
        hir: null,
        errors: [],
        isClass: true,
      });
    },
  });
  return classComponents;
};

const isModuleLevel = (path: NodePath | null): boolean =>
  path !== null &&
  (path.isProgram() || (path.isExportNamedDeclaration() && isModuleLevel(path.parentPath)));

const isModuleScopeFunction = (path: NodePath<types.Function>): path is BabelFunction => {
  const isAtModuleScope =
    isModuleLevel(path.parentPath) ||
    (path.parentPath.isVariableDeclarator() &&
      isModuleLevel(path.parentPath.parentPath.parentPath));
  return (
    isAtModuleScope &&
    (path.isFunctionDeclaration() ||
      path.isFunctionExpression() ||
      path.isArrowFunctionExpression())
  );
};

const createLoweringLogger =
  (capture: LoweringCapture) =>
  (pipelineValue: CompilerPipelineValue): void => {
    if (pipelineValue.kind !== "hir") return;
    const hirFunction = pipelineValue.value;
    const hasErrors = pipelineValue.name === "HIR" && hirFunction.env.hasErrors();
    if (!hasErrors && pipelineValue.name !== STOP_PASS) return;
    if (capture(hirFunction, hasErrors)) throw STOP;
  };

const createPluginOptions = (
  environment: PluginOptions["environment"],
  logger: PluginOptions["logger"],
): ParsedPluginOptions =>
  parsePluginOptions({
    compilationMode: "infer",
    outputMode: "lint",
    panicThreshold: "none",
    flowSuppressions: false,
    eslintSuppressionRules: [],
    environment: {
      ...environment,
      moduleTypeProvider: getModuleType,
      validateRefAccessDuringRender: false,
    },
    logger,
  });

const parseFile = (fileName: string, code: string): types.File | null => {
  try {
    return parseSync(code, {
      filename: fileName,
      babelrc: false,
      configFile: false,
      parserOpts: {
        plugins: /\.[cm]?ts$/.test(fileName)
          ? ["typescript", "decorators-legacy"]
          : ["typescript", "jsx", "decorators-legacy"],
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const lowerModuleFunction = (
  functionPath: BabelFunction,
  programPath: NodePath<types.Program>,
  pluginOptions: ParsedPluginOptions,
  fileName: string,
  code: string,
): HIRFunction | null => {
  let hir: HIRFunction | null = null;
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
    debugLogIRs: createLoweringLogger((hirFunction, hasErrors) => {
      if (!hasErrors) hir = hirFunction;
      return true;
    }),
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
  return hir;
};

const createModuleFunctionLowerer =
  (
    fileName: string,
    code: string,
    pluginOptions: ParsedPluginOptions,
    { programPath, moduleFunctionPaths }: ProgramFunctions,
  ): ModuleFunctionLoader =>
  (functionName) => {
    const functionPath = moduleFunctionPaths.get(functionName);
    return functionPath && programPath
      ? lowerModuleFunction(functionPath, programPath, pluginOptions, fileName, code)
      : null;
  };

const createModuleFunctionLoader = (lower: ModuleFunctionLoader): ModuleFunctionLoader => {
  const moduleFunctionsByName = new Map<string, HIRFunction | null>();
  return (functionName) => {
    if (!moduleFunctionsByName.has(functionName))
      moduleFunctionsByName.set(functionName, lower(functionName));
    return moduleFunctionsByName.get(functionName) ?? null;
  };
};

class CompiledFunctionCollector {
  readonly #compiledByLocation = new Map<string, CompiledFunction>();

  readonly recordEvent = (_fileName: string | null, event: LoggerEvent): void => {
    if (!("fnLoc" in event) || !event.fnLoc) return;
    const compiled = this.#getCompiledFunction(event.fnLoc);
    const errorReason = describeEvent(event);
    if (compiled.hir === null && errorReason && !errorReason.includes(STOP.toString()))
      compiled.errors.push(errorReason);
  };

  readonly recordLowering: LoweringCapture = (hirFunction, hasErrors) => {
    const { loc } = hirFunction;
    if (typeof loc === "symbol") return false;
    const compiled = this.#getCompiledFunction(loc);
    compiled.functionType = hirFunction.fnType;
    if (!hasErrors) {
      compiled.hir = hirFunction;
      return true;
    }
    compiled.errors.push(
      ...hirFunction.env.aggregateErrors().details.map((detail) => detail.reason),
    );
    return true;
  };

  getFunctions(namesByLocation: Map<string, string>): CompiledFunction[] {
    for (const [locationKey, compiled] of this.#compiledByLocation) {
      compiled.bindingName = namesByLocation.get(locationKey) ?? ANONYMOUS_NAME;
      compiled.name = compiled.hir?.id ?? compiled.bindingName;
      compiled.functionType ??= guessFunctionTypeFromName(compiled.name);
    }
    return [...this.#compiledByLocation.values()].filter(
      (compiled) => compiled.hir !== null || compiled.errors.length > 0,
    );
  }

  #getCompiledFunction(loc: types.SourceLocation): CompiledFunction {
    const locationKey = getLocationKey(loc);
    const compiled = this.#compiledByLocation.get(locationKey) ?? {
      name: ANONYMOUS_NAME,
      bindingName: ANONYMOUS_NAME,
      functionType: null,
      loc,
      hir: null,
      errors: [],
      isClass: false,
    };
    this.#compiledByLocation.set(locationKey, compiled);
    return compiled;
  }
}

const compileProgramFunctions = (
  ast: types.File,
  fileName: string,
  code: string,
  pluginOptions: ParsedPluginOptions,
): ProgramFunctions => {
  const programFunctions: ProgramFunctions = {
    programPath: null,
    namesByLocation: new Map(),
    moduleFunctionPaths: new Map(),
  };
  traverse(ast, {
    Program(path) {
      programFunctions.programPath = path;
      compileProgram(path, {
        opts: pluginOptions,
        filename: fileName,
        comments: ast.comments ?? [],
        code,
      });
    },
    Function(path) {
      const functionName = getFunctionName(path, code);
      if (path.node.loc)
        programFunctions.namesByLocation.set(getLocationKey(path.node.loc), functionName);
      if (isModuleScopeFunction(path)) programFunctions.moduleFunctionPaths.set(functionName, path);
    },
  });
  return programFunctions;
};

export const compileFile = (
  fileName: string,
  code: string,
  environment: PluginOptions["environment"] = {},
): CompiledFile => {
  const ast = parseFile(fileName, code);
  if (!ast) return EMPTY_COMPILED_FILE;
  const collector = new CompiledFunctionCollector();
  const pluginOptions = createPluginOptions(environment, {
    logEvent: collector.recordEvent,
    debugLogIRs: createLoweringLogger(collector.recordLowering),
  });
  const programFunctions = compileProgramFunctions(ast, fileName, code, pluginOptions);
  const lower = createModuleFunctionLowerer(fileName, code, pluginOptions, programFunctions);
  return {
    functions: [
      ...collector.getFunctions(programFunctions.namesByLocation),
      ...collectClassComponents(ast),
    ],
    loadModuleFunction: createModuleFunctionLoader(lower),
    lowerModuleFunction: lower,
    loadModuleConstant: createModuleConstantLoader(ast),
    loadModuleVariable: createModuleVariableLoader(ast),
  };
};
