import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { SourceFile } from "typescript/unstable/ast";
import type { CompiledFile, CompiledFunction } from "../compile/compile";
import type { SourceFileResolver } from "../type-checker/source-file-resolver";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { collectHandlers } from "../handlers/collect-handlers";
import { collectBindingIds } from "../shared/binding-graph";
import { Interpreter } from "../interpret/interpret";
import { PlaceMap } from "../values/place-map";
import { createDeclarationKey } from "./declaration-key";
import type { ProjectLoaders } from "../interpret/interpret";
import type {
  Bailout,
  Binding,
  Assertion,
  ComponentAnalysis,
  Handler,
  ContextSetterFields,
  StoreModel,
  SymbolicValue,
} from "../types";

interface ComponentIdentity extends Pick<
  ComponentAnalysis,
  "name" | "exportName" | "file" | "declaration"
> {}

export interface FileContext {
  sourceFile: SourceFile;
  resolver: SourceFileResolver;
  compiled: CompiledFile;
  projectLoaders: ProjectLoaders;
  modelsByStore: Map<string, StoreModel>;
  exportNames: Map<string, string>;
}

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

const addComparedSamples = (render: SymbolicValue): void => {
  forEachSymbolicValue(render, (value) => {
    if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return;
    const [comparedValue, literal] =
      value.left.kind === "Binding" ? [value.left, value.right] : [value.right, value.left];
    if (comparedValue.kind !== "Binding" || literal.kind !== "Primitive") return;
    const binding = comparedValue.binding;
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
  const declarationName =
    IDENTIFIER_PATTERN.test(reactFunction.bindingName) && reactFunction.bindingName !== "default"
      ? reactFunction.bindingName
      : reactFunction.name;
  return {
    name: reactFunction.name,
    exportName: fileContext.exportNames.get(declarationName) ?? null,
    file: fileContext.sourceFile.fileName,
    declaration: createDeclarationKey(fileContext.sourceFile.path, declarationName),
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
  providedContexts: [],
  contextSamples: new Map(),
  untypedContextBindingIds: new Map(),
  readContextKeys: [],
  placeDomains: new PlaceMap(),
  branchEvaluations: [],
  render,
  handlers: [],
  renders: [],
  assertions: [],
  bailouts: [],
  warnings: [],
});

const createBailoutAnalysis = (
  identity: ComponentIdentity,
  loc: SourceLocation,
  reason: "compiler-error" | "class-component",
  message: string,
): ComponentAnalysis => ({
  ...createEmptyAnalysis(identity, loc, { kind: "Unknown", reason, loc }),
  bailouts: [{ reason, message, loc }],
});

const getReadBindingIds = (
  render: SymbolicValue,
  handlers: Handler[],
  assertions: Assertion[],
  bindings: Binding[],
): Set<number> => {
  const readIds = collectBindingIds([
    render,
    ...handlers.flatMap((handler) =>
      handler.updates.flatMap((update) => [update.value, ...update.guards]),
    ),
    ...[...assertions, ...handlers.flatMap((handler) => handler.assertions)].flatMap(
      (assertion) => [assertion.subject, ...assertion.guards],
    ),
  ]);
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
  if (reactFunction.isClass)
    return createBailoutAnalysis(
      identity,
      reactFunction.loc,
      "class-component",
      reactFunction.name,
    );
  if (reactFunction.hir === null)
    return createBailoutAnalysis(
      identity,
      reactFunction.loc,
      "compiler-error",
      reactFunction.errors.join("; "),
    );
  const interpreter = new Interpreter(
    fileContext.resolver,
    fileContext.compiled.loadModuleFunction,
    fileContext.compiled.loadModuleConstant,
    fileContext.compiled.loadModuleVariable,
    fileContext.projectLoaders,
    contextSetterFields,
    fileContext.modelsByStore,
  );
  const render = interpreter.evaluateComponent(reactFunction.hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter);
  const readIds = getReadBindingIds(
    render,
    handlers,
    interpreter.assertionRecorder.assertions,
    interpreter.bindingTable.bindings,
  );
  return {
    ...identity,
    loc: reactFunction.hir.loc,
    isAsync: reactFunction.hir.async,
    isStrictNullChecks: fileContext.resolver.isStrictNullChecks,
    bindings: interpreter.bindingTable.bindings,
    wholePropsSample: interpreter.wholePropsSample,
    providedContexts: interpreter.providedContexts,
    contextSamples: interpreter.externalSources.contextSamples,
    untypedContextBindingIds: interpreter.externalSources.untypedContextBindingIds,
    readContextKeys: [...interpreter.externalSources.readContextKeys],
    placeDomains: interpreter.bindingTable.placeDomains,
    branchEvaluations: interpreter.branchEvaluations,
    render,
    handlers,
    renders: [...interpreter.renderedComponents],
    assertions: interpreter.assertionRecorder.assertions,
    bailouts: [
      ...interpreter.diagnostics.bailouts,
      ...getUntypedBailouts(interpreter.bindingTable.bindings, readIds),
    ],
    warnings: interpreter.diagnostics.warnings,
  };
};
