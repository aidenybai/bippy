import { describeError } from "../errors.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import { Interpreter } from "../evaluate/interpreter.js";
import { createScope } from "../evaluate/scope.js";
import { MAX_TIMER_TASKS } from "../evaluate/timers.js";
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
import { createTanStackRouterTransform } from "../graph/tanstack-router-plugin.js";
import {
  createViteAssetTransform,
  loadViteUserPlugins,
  transformViteDocumentShell,
} from "../graph/vite-asset-transform.js";
import { locateViteConfig } from "../graph/vite-config.js";
import { createYamlSourceTransforms } from "../graph/yaml-modules.js";
import { ensureDomGlobals, resetDomGlobals } from "../materialize/dom-environment.js";
import { Materializer } from "../materialize/materializer.js";
import { mountNode } from "../materialize/mount.js";
import {
  loadReactRuntime,
  type ReactPackageSpecifiers,
  type ReactRuntime,
} from "../materialize/react-runtime.js";
import type { RendererHost } from "../materialize/renderer-host.js";
import { SourceFileCache } from "../parse/parse-source-file.js";
import { toElementType } from "../react/element-type.js";
import type {
  Diagnostic,
  ExternalValueProvider,
  ModuleRecord,
  PinnedDecisions,
  ProjectContext,
  SourceTransform,
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

const resolveOptionalPath = (
  rootDirectory: string,
  filePath: string | undefined,
): string | undefined =>
  filePath === undefined ? undefined : path.resolve(rootDirectory, filePath);

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

/**
 * The parsed side of a renderer: resolution, the project and the module graph.
 * Nothing here changes while rendering (evaluated module state lives in each
 * `Interpreter`), so renderers over the same project share one.
 */
interface RendererProject {
  resolver: ModuleResolver;
  reactVersion: string | null;
  project: ProjectContext;
  documentShell: string | null;
  graph: ModuleGraph;
}

/** Either the parsed project to share, or the app's own bundler plugins (prepared by `createStaticRenderer`) to parse a new one with. */
interface RendererSetup {
  shared?: RendererProject;
  bundlerTransforms?: SourceTransform[];
}

/** Options a derived renderer may change without re-parsing the project. */
export interface RenderTimeOptions {
  decisions?: PinnedDecisions;
  externalValues?: ExternalValueProvider;
  serverComponents?: boolean;
}

export class StaticRenderer {
  readonly options: StaticRendererOptions;
  readonly graph: ModuleGraph;
  private readonly resolver: ModuleResolver;
  private readonly reactVersion: string | null;
  private readonly project: ProjectContext;
  private documentShell: string | null;
  private reactPackages: ReactPackageSpecifiers | undefined;

  constructor(options: StaticRendererOptions, setup: RendererSetup = {}) {
    // oxc-resolver returns real paths, so a symlinked root must be compared as one.
    this.options = { ...options, rootDirectory: realpathSync(options.rootDirectory) };
    const { resolver, reactVersion, project, documentShell, graph } =
      setup.shared ?? this.createProject(setup.bundlerTransforms ?? []);
    this.resolver = resolver;
    this.reactVersion = reactVersion;
    this.project = project;
    this.documentShell = documentShell;
    this.graph = graph;
  }

  private createProject(bundlerTransforms: SourceTransform[]): RendererProject {
    const { options } = this;
    const { rootDirectory } = options;
    const resolver = new ModuleResolver({
      tsconfigPath: options.tsconfigPath,
      aliases: Object.fromEntries(
        Object.entries(options.aliases ?? {}).map(([specifier, target]) => [
          specifier,
          path.resolve(rootDirectory, target),
        ]),
      ),
      conditionNames: options.conditionNames,
      rootDirectory,
    });
    const devDirectory = resolveOptionalPath(rootDirectory, options.devDirectory);
    const bundler = detectModuleBundler(rootDirectory, devDirectory);
    const project = createProjectContext({
      rootDirectory,
      resolver,
      servedDirectory: resolveOptionalPath(rootDirectory, options.servedDirectory),
      publicDirectory: resolveOptionalPath(rootDirectory, options.publicDirectory),
      environment: options.environment,
      devCommand: options.devCommand,
      devDirectory,
      observations: options.observations,
      origin: options.origin ?? null,
      transpiler: options.transpiler ?? detectModuleTranspiler(resolver, rootDirectory),
      bundler,
    });
    const svgrTransform = createSvgrSourceTransform(project, resolver, rootDirectory, options.svgr);
    return {
      resolver,
      reactVersion: project.readPackageVersion("react"),
      project,
      documentShell: readDocumentShell(
        rootDirectory,
        bundler,
        options.environment ?? null,
        project.servedDirectory ?? rootDirectory,
      ),
      graph: new ModuleGraph({
        resolver,
        sourceFileCache: new SourceFileCache([
          ...(svgrTransform ? [svgrTransform] : []),
          ...createYamlSourceTransforms(rootDirectory),
          ...bundlerTransforms,
        ]),
        resolveExternalPackages: options.resolveExternalPackages,
        externalPackageAllowList: options.externalPackageAllowList,
      }),
    };
  }

  /** A renderer over the same parsed project with some options changed; every render still gets a fresh interpreter. */
  derive(overrides: RenderTimeOptions): StaticRenderer {
    return new StaticRenderer(
      { ...this.options, ...overrides },
      {
        shared: {
          resolver: this.resolver,
          reactVersion: this.reactVersion,
          project: this.project,
          documentShell: this.documentShell,
          graph: this.graph,
        },
      },
    );
  }

  resolvePath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.options.rootDirectory, filePath);
  }

  /** Reshapes the page the way the dev server does before serving it, when the app has one. */
  async transformDocumentShell(
    transform: (html: string, servedDirectory: string) => Promise<string>,
  ): Promise<void> {
    if (this.documentShell === null) return;
    this.documentShell = await transform(
      this.documentShell,
      this.project.servedDirectory ?? this.options.rootDirectory,
    );
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

  /** Materializes with the React build a framework serves in place of the app's own `react`/`react-dom`. */
  setReactPackages(packages: ReactPackageSpecifiers): void {
    this.reactPackages = packages;
  }

  private loadRuntime(): Promise<ReactRuntime> {
    ensureDomGlobals();
    return loadReactRuntime({
      resolver: this.resolver,
      rootDirectory: this.options.rootDirectory,
      packages: this.reactPackages,
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
      decisions: this.options.decisions,
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
   * with the statements that lead up to it; the last call to run wins, and a
   * call inside a callback sees the callback's arguments as unknowns. An entry
   * without such a call (it mounts through an imported function, possibly from
   * a timer task or a promise reaction) runs whole, then its queued tasks run
   * until one renders, and the element the first evaluated root render received
   * is used. Null (with a diagnostic) when no root render happens.
   */
  evaluateEntryElement(interpreter: Interpreter, module: ModuleRecord): StaticValue | null {
    const rootCalls = findRootRenderCalls(module);
    if (rootCalls.length === 0) {
      interpreter.initializeModule(module);
      const { timers } = interpreter;
      for (
        let round = 0;
        interpreter.rootRender.element === null &&
        round < MAX_TIMER_TASKS &&
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
        `${rootCalls.length} root render calls found in ${module.filePath}; using the last to run`,
        null,
        "warning",
      );
    }
    const rootCall = rootCalls[rootCalls.length - 1];
    interpreter.initializeModule(
      module,
      module.sideEffectStatements.filter((statement) => statement.end <= rootCall.call.start),
    );
    const moduleContext = interpreter.createModuleContext(module);
    const context = { ...moduleContext, scope: createScope(moduleContext.scope) };
    if (rootCall.enclosingFunction) {
      interpreter.bindUnknownParameters(
        rootCall.enclosingFunction.params,
        context.scope,
        context,
        "argument of the callback that renders the root",
      );
    }
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

/**
 * A renderer with the app's own Vite plugins loaded: their `transform` hooks
 * produce the modules non-JavaScript imports link and their `transformIndexHtml`
 * hooks shape the page the dev server serves.
 */
export const createStaticRenderer = async (
  options: StaticRendererOptions,
): Promise<StaticRenderer> => {
  const rootDirectory = realpathSync(options.rootDirectory);
  const viteConfig = locateViteConfig({
    rootDirectory,
    devDirectory: resolveOptionalPath(rootDirectory, options.devDirectory),
    devCommand: options.devCommand,
  });
  const viteUserPlugins =
    viteConfig && (await loadViteUserPlugins(viteConfig, options.modeledVitePlugins));
  const transforms = [
    viteConfig && (await createTanStackRouterTransform(viteConfig)),
    viteUserPlugins && createViteAssetTransform(viteUserPlugins),
  ].filter((transform) => transform !== null);
  const renderer = new StaticRenderer(options, { bundlerTransforms: transforms });
  if (viteUserPlugins) {
    await renderer.transformDocumentShell((html, servedDirectory) =>
      transformViteDocumentShell(viteUserPlugins, html, servedDirectory, options.route ?? "/"),
    );
  }
  return renderer;
};
