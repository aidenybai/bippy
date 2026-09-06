import path from "node:path";
import { Interpreter } from "../evaluate/interpreter.js";
import { createScope } from "../evaluate/scope.js";
import { objectValue, unknownValue } from "../evaluate/values.js";
import { FiberBuilder } from "../fiber/build-fiber.js";
import { ModuleGraph } from "../graph/module-graph.js";
import { ModuleResolver } from "../graph/module-resolver.js";
import { toElementType } from "../react/element-type.js";
import type {
  Diagnostic,
  ModuleRecord,
  SourceLocation,
  StaticObjectValue,
  StaticRenderResult,
  StaticRendererOptions,
  StaticValue,
} from "../types.js";
import { findRootRenderCalls } from "./find-root-elements.js";

export interface RenderComponentOptions {
  exportName?: string;
  props?: StaticObjectValue;
}

export class StaticRenderer {
  readonly options: StaticRendererOptions;
  readonly graph: ModuleGraph;

  constructor(options: StaticRendererOptions) {
    this.options = options;
    this.graph = new ModuleGraph({
      resolver: new ModuleResolver({
        tsconfigPath: options.tsconfigPath,
        conditionNames: options.conditionNames,
        rootDirectory: options.rootDirectory,
      }),
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

  private createInterpreter(): Interpreter {
    return new Interpreter(this.graph, {
      maxCallDepth: this.options.maxCallDepth,
      maxSteps: this.options.maxSteps,
      externalValues: this.options.externalValues,
    });
  }

  private createBuilder(interpreter: Interpreter): FiberBuilder {
    return new FiberBuilder(interpreter, {
      maxComponentDepth: this.options.maxComponentDepth,
      maxFiberCount: this.options.maxFiberCount,
      maxRecursionPerComponent: this.options.maxRecursionPerComponent,
      supportsSingletons: this.options.supportsSingletons,
      serverComponents: this.options.serverComponents,
    });
  }

  private finish(
    interpreter: Interpreter,
    builder: FiberBuilder,
    rootValue: StaticValue,
    location: SourceLocation | null,
  ): StaticRenderResult {
    const root = builder.buildRoot(rootValue, location);
    builder.stats.modulesLoaded = this.graph.loadedModuleCount;
    return { root, diagnostics: [...interpreter.diagnostics], stats: builder.stats };
  }

  private missingModuleResult(filePath: string, message: string): StaticRenderResult {
    const interpreter = this.createInterpreter();
    const builder = this.createBuilder(interpreter);
    const diagnostic: Diagnostic = {
      severity: "error",
      code: "module-not-found",
      message,
      location: null,
    };
    interpreter.diagnostics.push(diagnostic);
    return this.finish(interpreter, builder, unknownValue(`${filePath}: ${message}`), null);
  }

  renderComponent(filePath: string, options: RenderComponentOptions = {}): StaticRenderResult {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const exportName = options.exportName ?? "default";
    const interpreter = this.createInterpreter();
    const builder = this.createBuilder(interpreter);
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
    return this.finish(interpreter, builder, element, null);
  }

  renderEntry(filePath: string): StaticRenderResult {
    const absolutePath = this.resolvePath(filePath);
    const module = this.graph.getModule(absolutePath);
    if (!module) return this.missingModuleResult(absolutePath, `could not parse ${absolutePath}`);
    const interpreter = this.createInterpreter();
    const builder = this.createBuilder(interpreter);
    const entry = this.evaluateEntryElement(interpreter, module);
    if (!entry) return this.finish(interpreter, builder, unknownValue("no root render call"), null);
    return this.finish(interpreter, builder, entry.value, entry.location);
  }

  /**
   * Evaluates the element handed to the root render call of an entry module
   * (`createRoot().render(<App />)`, `hydrateRoot(document, <App />)`), together
   * with the statements that lead up to it. Null (with a diagnostic) when the
   * module has no such call.
   */
  evaluateEntryElement(
    interpreter: Interpreter,
    module: ModuleRecord,
  ): { value: StaticValue; location: SourceLocation | null } | null {
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
    return {
      value: interpreter.evaluateExpression(rootCall.element, context),
      location: interpreter.locate(module, rootCall.call),
    };
  }

  renderWith(produce: (interpreter: Interpreter) => StaticValue): StaticRenderResult {
    const interpreter = this.createInterpreter();
    const builder = this.createBuilder(interpreter);
    return this.finish(interpreter, builder, produce(interpreter), null);
  }
}

export const createStaticRenderer = (options: StaticRendererOptions): StaticRenderer =>
  new StaticRenderer(options);
