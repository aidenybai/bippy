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
import type { ProjectLoaders } from "./interpret";
import type {
  Bailout,
  Binding,
  Claim,
  ComponentAnalysis,
  Handler,
  ContextSetterFields,
  StoreModel,
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
  projectLoaders: ProjectLoaders;
  modelsByStore: Map<string, StoreModel>;
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

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

const getComponentIdentity = (
  reactFunction: CompiledFunction,
  fileContext: FileContext,
): ComponentIdentity => {
  const { sourceFile, exportNames, displayNames } = fileContext;
  const { bindingName } = reactFunction;
  const declarationName =
    IDENTIFIER_PATTERN.test(bindingName) && bindingName !== "default"
      ? bindingName
      : reactFunction.name;
  return {
    name: reactFunction.name,
    exportName: exportNames.get(declarationName) ?? null,
    runtimeName: displayNames.has(reactFunction.name)
      ? (displayNames.get(reactFunction.name) ?? null)
      : reactFunction.name,
    file: sourceFile.fileName,
    declaration: createDeclarationKey(sourceFile.path, declarationName),
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
  isStrictNullChecks: true,
  bindings: [],
  wholePropsSample: null,
  decidedBranchOutcomes: new Map(),
  providedContexts: [],
  contextSamples: new Map(),
  untypedContextBindingIds: new Map(),
  readContextKeys: [],
  placeDomains: new PlaceMap(),
  unionMemberValues: new PlaceMap(),
  render,
  localRenders: [],
  handlers: [],
  renders: [],
  claims: [],
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

const createClassAnalysis = (
  identity: ComponentIdentity,
  reactFunction: CompiledFunction,
): ComponentAnalysis => {
  const { loc } = reactFunction;
  return {
    ...createEmptyAnalysis(identity, loc, { kind: "Unknown", reason: "class-component", loc }),
    bailouts: [{ reason: "class-component", message: reactFunction.name, loc }],
  };
};

const getReadBindingIds = (
  render: SymbolicValue,
  handlers: Handler[],
  claims: Claim[],
  bindings: Binding[],
): Set<number> => {
  const readIds = new Set<number>();
  const visit = (value: SymbolicValue): void =>
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") readIds.add(part.binding.id);
    });
  visit(render);
  for (const handler of handlers)
    for (const update of handler.updates) [update.value, ...update.guards].forEach(visit);
  for (const claim of [...claims, ...handlers.flatMap((handler) => handler.claims)])
    [claim.subject, ...claim.guards].forEach(visit);
  for (const binding of bindings)
    for (const place of binding.inputPlaces) readIds.add(place.bindingId);
  return readIds;
};

const getUntypedBailouts = (bindings: Binding[], readIds: Set<number>): Bailout[] =>
  bindings.flatMap((binding): Bailout[] =>
    binding.domain.kind === "Unknown" && readIds.has(binding.id)
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
  if (reactFunction.isClass) return createClassAnalysis(identity, reactFunction);
  if (hir === null) return createCompilerErrorAnalysis(identity, reactFunction);
  const interpreter = new Interpreter(
    fileContext.resolver,
    fileContext.compiled.loadModuleFunction,
    fileContext.compiled.loadModuleConstant,
    fileContext.compiled.loadModuleVariable,
    fileContext.projectLoaders,
    contextSetterFields,
    fileContext.modelsByStore,
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter);
  const { bindings, placeDomains, unionMemberValues } = interpreter.bindingTable;
  const readIds = getReadBindingIds(render, handlers, interpreter.claims, bindings);
  return {
    ...identity,
    loc: hir.loc,
    isAsync: hir.async,
    isStrictNullChecks: fileContext.resolver.isStrictNullChecks,
    bindings,
    wholePropsSample: interpreter.wholePropsSample,
    decidedBranchOutcomes: interpreter.decidedBranchOutcomes,
    providedContexts: interpreter.providedContexts,
    contextSamples: interpreter.externalSources.contextSamples,
    untypedContextBindingIds: interpreter.externalSources.untypedContextBindingIds,
    readContextKeys: [...interpreter.externalSources.readContextKeys],
    placeDomains,
    unionMemberValues,
    render,
    localRenders: interpreter.localRenders,
    handlers,
    renders: [...interpreter.renderedComponents],
    claims: interpreter.claims,
    bailouts: [...interpreter.diagnostics.bailouts, ...getUntypedBailouts(bindings, readIds)],
    warnings: interpreter.diagnostics.warnings,
  };
};
