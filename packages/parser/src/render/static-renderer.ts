import { realpathSync } from "node:fs";
import path from "node:path";
import { Interpreter } from "../evaluate/interpreter.js";
import { createScope } from "../evaluate/scope.js";
import { objectValue, unknownValue } from "../evaluate/values.js";
import { ModuleGraph } from "../graph/module-graph.js";
import { ModuleResolver } from "../graph/module-resolver.js";
import { createProjectContext } from "../graph/project-context.js";
import { ensureDomGlobals } from "../materialize/dom-environment.js";
import { Materializer } from "../materialize/materializer.js";
import { mountNode } from "../materialize/mount.js";
import { loadReactRuntime, type ReactRuntime } from "../materialize/react-runtime.js";
import { readReactVersion } from "../react/element-shape.js";
import { toElementType } from "../react/element-type.js";
import type {
  Diagnostic,
  ModuleRecord,
  ProjectContext,
  StaticObjectValue,
  StaticRenderResult,
  StaticRendererOptions,
  StaticValue,
} from "../types.js";
import { findRootRenderCalls } from "./find-root-elements.js";
import { computeRenderStats } from "./render-stats.js";

export interface RenderComponentOptions {
  exportName?: string;
  props?: StaticObjectValue;
  /** The component is rendered somewhere inside a larger app, so unprovided contexts may still be provided. */
  isolated?: boolean;
}

interface BootstrapCall {
  filePath: string;
  exportName: string;
  globalNames: string[];
}

const BOOTSTRAP_PATTERN = /^(.+)#([^#()]+?)(?:\(([^()]*)\))?$/;

const parseBootstrap = (bootstrap: string): BootstrapCall | null => {
  const match = BOOTSTRAP_PATTERN.exec(bootstrap);
  if (!match) return null;
  const [, filePath, exportName, argumentList = ""] = match;
  return {
    filePath,
    exportName,
    globalNames: argumentList
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  };
};

export class StaticRenderer {
  readonly options: StaticRendererOptions;
  readonly graph: ModuleGraph;
  private readonly resolver: ModuleResolver;
  private readonly reactVersion: string | null;
  private readonly project: ProjectContext;

  constructor(options: StaticRendererOptions) {
    // oxc-resolver returns real paths, so a symlinked root must be compared as one.
    this.options = { ...options, rootDirectory: realpathSync(options.rootDirectory) };
    this.resolver = new ModuleResolver({
      tsconfigPath: options.tsconfigPath,
      conditionNames: options.conditionNames,
      rootDirectory: this.options.rootDirectory,
    });
    this.reactVersion = readReactVersion(this.resolver, this.options.rootDirectory);
    this.project = createProjectContext(this.options.rootDirectory, this.options.observations);
    this.graph = new ModuleGraph({
      resolver: this.resolver,
      resolveExternalPackages: options.resolveExternalPackages,
      externalPackageAllowList: options.externalPackageAllowList,
    });
  }

  resolvePath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.options.rootDirectory, filePath);
  }

  loadModule(filePath: string): ModuleRecord | null {
    return this.graph.getModule(this.resolvePath(filePath));
  }

  private createInterpreter(assumeOuterProviders = false): Interpreter {
    const interpreter = new Interpreter(this.graph, {
      maxCallDepth: this.options.maxCallDepth,
      maxSteps: this.options.maxSteps,
      externalValues: this.options.externalValues,
      globals: this.options.globals,
      capturedGlobals: this.options.observations?.globals,
      assumeOuterProviders,
      reactVersion: this.reactVersion,
      project: this.project,
    });
    for (const bootstrap of this.options.bootstrap ?? []) this.runBootstrap(interpreter, bootstrap);
    return interpreter;
  }

  private runBootstrap(interpreter: Interpreter, bootstrap: string): void {
    const parsed = parseBootstrap(bootstrap);
    const module = parsed ? this.graph.getModule(this.resolvePath(parsed.filePath)) : null;
    if (!parsed || !module) {
      interpreter.report(
        "bootstrap",
        `bootstrap "${bootstrap}" is not a parseable path#export(globals)`,
        null,
        "error",
      );
      return;
    }
    const callee = interpreter.evaluateModuleExport(module, parsed.exportName);
    const args = parsed.globalNames.map((name) => interpreter.getWindowGlobal(name));
    interpreter.callValue(callee, args, interpreter.createModuleContext(module), null);
  }

  private loadRuntime(): Promise<ReactRuntime> {
    ensureDomGlobals();
    return loadReactRuntime({
      resolver: this.resolver,
      rootDirectory: this.options.rootDirectory,
    });
  }

  /**
   * Materializes the evaluated root value into real React elements (source
   * components become interpreter-backed proxies), mounts them through the
   * app's own react-dom and records the committed fibers.
   */
  private async finish(
    interpreter: Interpreter,
    rootValue: StaticValue,
  ): Promise<StaticRenderResult> {
    const runtime = await this.loadRuntime();
    const materializer = new Materializer(interpreter, runtime, {
      maxComponentDepth: this.options.maxComponentDepth,
      maxFiberCount: this.options.maxFiberCount,
      maxRecursionPerComponent: this.options.maxRecursionPerComponent,
      serverComponents: this.options.serverComponents,
    });
    const mounted = await mountNode(runtime, materializer.toRootNode(rootValue));
    for (const error of mounted.uncaughtErrors) {
      interpreter.report(
        "render-error",
        `React failed to render the materialized tree: ${describeError(error)}`,
        null,
        "error",
      );
    }
    return {
      snapshot: mounted.snapshot,
      diagnostics: [...interpreter.diagnostics],
      stats: computeRenderStats(mounted.snapshot, this.graph.loadedModuleCount),
    };
  }

  private missingModuleResult(filePath: string, message: string): Promise<StaticRenderResult> {
    const interpreter = this.createInterpreter();
    const diagnostic: Diagnostic = {
      severity: "error",
      code: "module-not-found",
      message,
      location: null,
    };
    interpreter.diagnostics.push(diagnostic);
    return this.finish(interpreter, unknownValue(`${filePath}: ${message}`));
  }

  renderComponent(
    filePath: string,
    options: RenderComponentOptions = {},
  ): Promise<StaticRenderResult> {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const exportName = options.exportName ?? "default";
    const interpreter = this.createInterpreter(options.isolated ?? false);
    const componentValue = interpreter.evaluateModuleExport(module, exportName);
    const type = toElementType(
      componentValue,
      exportName === "default"
        ? path.basename(absolutePath, path.extname(absolutePath))
        : exportName,
    );
    const element: StaticValue = {
      kind: "element",
      type,
      key: null,
      props: options.props ?? objectValue([]),
      location: null,
      environment: null,
    };
    return this.finish(interpreter, element);
  }

  renderEntry(filePath: string): Promise<StaticRenderResult> {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const interpreter = this.createInterpreter();
    const entry = this.evaluateEntryElement(interpreter, module);
    return this.finish(interpreter, entry ?? unknownValue("no root render call"));
  }

  /**
   * Evaluates the element handed to the root render call of an entry module
   * (`createRoot().render(<App />)`, `hydrateRoot(document, <App />)`), together
   * with the statements that lead up to it. Null (with a diagnostic) when the
   * module has no such call.
   */
  evaluateEntryElement(interpreter: Interpreter, module: ModuleRecord): StaticValue | null {
    const rootCalls = findRootRenderCalls(module);
    if (rootCalls.length === 0) {
      interpreter.report(
        "no-root-render",
        `no createRoot().render / hydrateRoot / ReactDOM.render call found in ${module.filePath}`,
        null,
        "error",
      );
      return null;
    }
    if (rootCalls.length > 1) {
      interpreter.report(
        "multiple-root-renders",
        `${rootCalls.length} root render calls found in ${module.filePath}; using the first`,
        null,
        "warning",
      );
    }
    const rootCall = rootCalls[0];
    const moduleContext = interpreter.createModuleContext(module);
    const context = { ...moduleContext, scope: createScope(moduleContext.scope) };
    for (const statements of rootCall.enclosingStatements) {
      interpreter.evaluateBlock(statements, context, false);
    }
    return interpreter.evaluateExpression(rootCall.element, context);
  }

  renderWith(produce: (interpreter: Interpreter) => StaticValue): Promise<StaticRenderResult> {
    const interpreter = this.createInterpreter();
    return this.finish(interpreter, produce(interpreter));
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createStaticRenderer = (options: StaticRendererOptions): StaticRenderer =>
  new StaticRenderer(options);
