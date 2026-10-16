import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { SourceFile } from "typescript/unstable/ast";
import type { CompiledFile, CompiledFunction } from "./compile";
import type { SourceFileResolver } from "./source-file-resolver";
import { EQUALITY_OPERATORS } from "./constraints";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { collectHandlers } from "./collect-handlers";
import { Interpreter } from "./interpret";
import { PlaceMap } from "./utils/place-map";
import { createDeclarationKey } from "./utils/declaration-key";
import type { ProjectHookLoader } from "./interpret";
import type {
  Bailout,
  Binding,
  ComponentAnalysis,
  ContextSetterFields,
  StoreActions,
  SymbolicValue,
} from "./types";

export interface ComponentIdentity extends Pick<
  ComponentAnalysis,
  "name" | "exportName" | "runtimeName" | "file" | "declaration"
> {}

export interface FileContext {
  sourceFile: SourceFile;
  resolver: SourceFileResolver;
  compiled: CompiledFile;
  loadProjectHook: ProjectHookLoader;
  actionsByStore: Map<string, StoreActions>;
  exportNames: Map<string, string>;
  displayNames: Map<string, string | null>;
}

const addComparedSamples = (render: SymbolicValue): void => {
  forEachSymbolicValue(render, (value) => {
    if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return;
    const [comparedValue, literal] =
      value.left.kind === "Binding" ? [value.left, value.right] : [value.right, value.left];
    if (comparedValue.kind !== "Binding" || literal.kind !== "Primitive") return;
    const { binding } = comparedValue;
    if (binding.kind !== "prop" || comparedValue.path.length > 0) return;
    if (typeof literal.value !== "string" && typeof literal.value !== "number") return;
    const hasSample = binding.samples.some(
      (sample) => sample.kind === "Value" && sample.value === literal.value,
    );
    if (!hasSample) binding.samples.push({ kind: "Value", value: literal.value });
  });
};

const getComponentIdentity = (
  reactFunction: CompiledFunction,
  fileContext: FileContext,
): ComponentIdentity => {
  const { sourceFile, exportNames, displayNames } = fileContext;
  return {
    name: reactFunction.name,
    exportName: exportNames.get(reactFunction.name) ?? null,
    runtimeName: displayNames.has(reactFunction.name)
      ? (displayNames.get(reactFunction.name) ?? null)
      : reactFunction.name,
    file: sourceFile.fileName,
    declaration: createDeclarationKey(sourceFile.path, reactFunction.name),
  };
};

export const createEmptyAnalysis = (
  identity: ComponentIdentity,
  loc: SourceLocation,
  render: SymbolicValue,
): ComponentAnalysis => ({
  ...identity,
  loc,
  isAsync: false,
  bindings: [],
  wholePropsSample: null,
  decidedBranchOutcomes: new Map(),
  providedContexts: [],
  contextSamples: new Map(),
  untypedContextBindingIds: new Map(),
  placeDomains: new PlaceMap(),
  unionMemberValues: new PlaceMap(),
  render,
  handlers: [],
  renders: [],
  bailouts: [],
  warnings: [],
});

const createCompilerErrorAnalysis = (
  identity: ComponentIdentity,
  reactFunction: CompiledFunction,
): ComponentAnalysis => {
  const { loc } = reactFunction;
  return {
    ...createEmptyAnalysis(identity, loc, { kind: "Unknown", reason: "compiler-error", loc }),
    bailouts: [{ reason: "compiler-error", message: reactFunction.errors.join("; "), loc }],
  };
};

const getUntypedBailouts = (bindings: Binding[]): Bailout[] =>
  bindings.flatMap((binding): Bailout[] =>
    binding.domain.kind === "Unknown"
      ? [{ reason: `untyped-${binding.kind}`, message: binding.name, loc: binding.loc }]
      : [],
  );

export const analyzeComponent = (
  reactFunction: CompiledFunction,
  fileContext: FileContext,
  contextSetterFields: ContextSetterFields,
): ComponentAnalysis => {
  const identity = getComponentIdentity(reactFunction, fileContext);
  const { hir } = reactFunction;
  if (hir === null) return createCompilerErrorAnalysis(identity, reactFunction);
  const interpreter = new Interpreter(
    fileContext.resolver,
    fileContext.compiled.loadModuleFunction,
    fileContext.loadProjectHook,
    contextSetterFields,
    fileContext.actionsByStore,
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter);
  const { bindings, placeDomains, unionMemberValues } = interpreter.bindingTable;
  return {
    ...identity,
    loc: hir.loc,
    isAsync: hir.async,
    bindings,
    wholePropsSample: interpreter.wholePropsSample,
    decidedBranchOutcomes: interpreter.decidedBranchOutcomes,
    providedContexts: interpreter.providedContexts,
    contextSamples: interpreter.externalSources.contextSamples,
    untypedContextBindingIds: interpreter.externalSources.untypedContextBindingIds,
    placeDomains,
    unionMemberValues,
    render,
    handlers,
    renders: [...interpreter.renderedComponents],
    bailouts: [...interpreter.diagnostics.bailouts, ...getUntypedBailouts(bindings)],
    warnings: interpreter.diagnostics.warnings,
  };
};
