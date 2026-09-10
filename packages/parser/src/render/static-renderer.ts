import { describeError } from "../errors.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import { Interpreter } from "../evaluate/interpreter.js";
import { createScope } from "../evaluate/scope.js";
import { objectValue, unknownValue } from "../evaluate/values.js";
import {
  detectModuleBundler,
  detectModuleTranspiler,
  readDocumentShell,
} from "../graph/module-transpiler.js";
import { ModuleGraph } from "../graph/module-graph.js";
import { ModuleResolver } from "../graph/module-resolver.js";
import { createProjectContext } from "../graph/project-context.js";
import { createSvgrSourceTransform } from "../graph/svgr-modules.js";
import { createYamlSourceTransforms } from "../graph/yaml-modules.js";
import { ensureDomGlobals, resetDomGlobals } from "../materialize/dom-environment.js";
import { Materializer } from "../materialize/materializer.js";
import { mountNode } from "../materialize/mount.js";
import { loadReactRuntime, type ReactRuntime } from "../materialize/react-runtime.js";
import type { RendererHost } from "../materialize/renderer-host.js";
import { SourceFileCache } from "../parse/parse-source-file.js";
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
import { createDomHost } from "./dom-host.js";
import { findRootRenderCalls } from "./find-root-elements.js";
import { computeRenderStats } from "./render-stats.js";

export interface RenderComponentOptions {
  exportName?: string;
  props?: StaticObjectValue;
  /** The component is rendered somewhere inside a larger app, so unprovided contexts may still be provided. */
  isolated?: boolean;
}

/** One analysis: the interpreter over a fresh document, and the renderer host that mounts what it evaluates. */
interface AnalysisRun {
  interpreter: Interpreter;
  host: RendererHost<Element>;
}

interface BootstrapCall {
  filePath: string;
  exportName: string;
  globalNames: string[];
}

const BOOTSTRAP_PATTERN = /^(.+)#([^#()]+?)(?:\(([^()]*)\))?$/;
/** Timer tasks an entry may run before its root render, matching the mount's settle rounds. */
const MAX_BOOTSTRAP_TASKS = 512;

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
  private readonly documentShell: string | null;

  constructor(options: StaticRendererOptions) {
    // oxc-resolver returns real paths, so a symlinked root must be compared as one.
    this.options = { ...options, rootDirectory: realpathSync(options.rootDirectory) };
    this.resolver = new ModuleResolver({
      tsconfigPath: options.tsconfigPath,
      aliases: Object.fromEntries(
        Object.entries(options.aliases ?? {}).map(([specifier, target]) => [
          specifier,
          path.resolve(this.options.rootDirectory, target),
        ]),
      ),
      conditionNames: options.conditionNames,
      rootDirectory: this.options.rootDirectory,
    });
    const { rootDirectory } = this.options;
    const devDirectory = this.resolveOptionalPath(options.devDirectory);
    const bundler = detectModuleBundler(rootDirectory, devDirectory);
    this.project = createProjectContext({
      rootDirectory,
      resolver: this.resolver,
      servedDirectory: this.resolveOptionalPath(options.servedDirectory),
      publicDirectory: this.resolveOptionalPath(options.publicDirectory),
      environment: this.options.environment,
      devCommand: this.options.devCommand,
      devDirectory,
      observations: this.options.observations,
      origin: this.options.origin ?? null,
      transpiler: this.options.transpiler ?? detectModuleTranspiler(this.resolver, rootDirectory),
      bundler,
    });
    this.documentShell = readDocumentShell(
      rootDirectory,
      bundler,
      options.environment ?? null,
      this.project.servedDirectory ?? rootDirectory,
    );
    this.reactVersion = this.project.readPackageVersion("react");
    const svgrTransform = createSvgrSourceTransform(
      this.project,
      this.resolver,
      rootDirectory,
      options.svgr,
    );
    this.graph = new ModuleGraph({
      resolver: this.resolver,
      sourceFileCache: new SourceFileCache([
        ...(svgrTransform ? [svgrTransform] : []),
        ...createYamlSourceTransforms(rootDirectory),
      ]),
      resolveExternalPackages: options.resolveExternalPackages,
      externalPackageAllowList: options.externalPackageAllowList,
    });
  }

  resolvePath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.options.rootDirectory, filePath);
  }

  private resolveOptionalPath(filePath: string | undefined): string | undefined {
    return filePath === undefined ? undefined : this.resolvePath(filePath);
  }

  loadModule(filePath: string): ModuleRecord | null {
    return this.graph.getModule(this.resolvePath(filePath));
  }

  private startRun(assumeOuterProviders = false): AnalysisRun {
    resetDomGlobals(this.documentShell);
    const host = createDomHost(this.documentShell !== null);
    const interpreter = new Interpreter(this.graph, {
      maxCallDepth: this.options.maxCallDepth,
      maxSteps: this.options.maxSteps,
      externalValues: this.options.externalValues,
      globals: this.options.globals,
      defines: this.options.defines,
      environment: this.options.environment,
      hostPlatform: this.options.hostPlatform,
      hostDocument: host.hostDocument,
      capturedGlobals: this.options.observations?.globals,
      route: this.options.route,
      origin: this.options.origin,
      page: this.options.observations?.page,
      assumeOuterProviders,
      reactVersion: this.reactVersion,
      project: this.project,
      settleMs: this.options.settleMs,
      timerUnderrunMs: this.options.timerUnderrunMs,
    });
    for (const bootstrap of this.options.bootstrap ?? []) this.runBootstrap(interpreter, bootstrap);
    return { interpreter, host };
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
    { interpreter, host }: AnalysisRun,
    rootValue: StaticValue,
  ): Promise<StaticRenderResult> {
    const runtime = await this.loadRuntime();
    const materializer = new Materializer(interpreter, runtime, host, {
      maxComponentDepth: this.options.maxComponentDepth,
      maxFiberCount: this.options.maxFiberCount,
      maxRecursionPerComponent: this.options.maxRecursionPerComponent,
      serverComponents: this.options.serverComponents,
    });
    const rootNode = materializer.toRootNode(rootValue);
    interpreter.timers.drainMicrotasks();
    const mounted = await mountNode(runtime, host, rootNode, interpreter.timers, () =>
      materializer.resetElementBudget(),
    );
    if (interpreter.timers.hasTasks()) {
      interpreter.report(
        "timers-unsettled",
        "timer tasks were still queueing more tasks when the settle rounds ran out",
        null,
        "warning",
      );
    }
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
      commits: mounted.commits,
      diagnostics: [...interpreter.diagnostics],
      stats: computeRenderStats(mounted.snapshot, this.graph.loadedModuleCount),
    };
  }

  private missingModuleResult(filePath: string, message: string): Promise<StaticRenderResult> {
    const run = this.startRun();
    const diagnostic: Diagnostic = {
      severity: "error",
      code: "module-not-found",
      message,
      location: null,
    };
    run.interpreter.diagnostics.push(diagnostic);
    return this.finish(run, unknownValue(`${filePath}: ${message}`));
  }

  renderComponent(
    filePath: string,
    options: RenderComponentOptions = {},
  ): Promise<StaticRenderResult> {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const exportName = options.exportName ?? "default";
    const run = this.startRun(options.isolated ?? false);
    const componentValue = run.interpreter.evaluateModuleExport(module, exportName);
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
    return this.finish(run, element);
  }

  renderEntry(filePath: string): Promise<StaticRenderResult> {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const run = this.startRun();
    const entry = this.evaluateEntryElement(run.interpreter, module);
    return this.finish(run, entry ?? unknownValue("no root render call"));
  }

  /**
   * Evaluates the element handed to the root render call of an entry module
   * (`createRoot().render(<App />)`, `hydrateRoot(document, <App />)`), together
   * with the statements that lead up to it. An entry without such a call (it
   * mounts through an imported function, possibly from a timer task or a
   * promise reaction) runs whole, then its queued tasks run until one renders,
   * and the element the first evaluated root render received is used. Null
   * (with a diagnostic) when no root render happens.
   */
  evaluateEntryElement(interpreter: Interpreter, module: ModuleRecord): StaticValue | null {
    const rootCalls = findRootRenderCalls(module);
    if (rootCalls.length === 0) {
      interpreter.initializeModule(module);
      const { timers } = interpreter;
      for (
        let round = 0;
        interpreter.rootRender.element === null &&
        round < MAX_BOOTSTRAP_TASKS &&
        (timers.hasTasks() || timers.hasMicrotasks());
        round++
      ) {
        timers.runNextTask();
      }
      if (interpreter.rootRender.element) return interpreter.rootRender.element;
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
    interpreter.initializeModule(
      module,
      module.sideEffectStatements.filter((statement) => statement.end <= rootCall.call.start),
    );
    const moduleContext = interpreter.createModuleContext(module);
    const context = { ...moduleContext, scope: createScope(moduleContext.scope) };
    for (const statements of rootCall.enclosingStatements) {
      interpreter.evaluateBlock(statements, context, false);
    }
    return interpreter.evaluateExpression(rootCall.element, context);
  }

  renderWith(produce: (interpreter: Interpreter) => StaticValue): Promise<StaticRenderResult> {
    const run = this.startRun();
    return this.finish(run, produce(run.interpreter));
  }
}

export const createStaticRenderer = (options: StaticRendererOptions): StaticRenderer =>
  new StaticRenderer(options);
