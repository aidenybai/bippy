import { resolve } from "node:path";
import { CompilerTypeProvider } from "../../src/core/type-provider";
import { isProjectSourceFile, withProject } from "../../src/core/utils/with-project";
import { compileFile } from "../../src/core/compile";
import { analyzeProject } from "../../src/core/analyze-project";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import type { HIRFunction, Instruction, Type } from "../../src/react-compiler/HIR/HIR";
import { eachInstructionLValue } from "../../src/react-compiler/HIR/visitors";
import { isFunctionCreation } from "../../src/core/utils/hir";
import type {
  AbstractValue,
  AnalyzedComponent,
  Binding,
  BindingPlace,
  ComponentAnalysis,
  ProjectAnalysis,
  StateReport,
} from "../../src/core/types";
import { createEmptyAnalysis } from "../../src/core/analyze-component";
import { PlaceMap } from "../../src/core/utils/place";
import type { Capture } from "../conformance/verifier/types";

export const getFixtureConfig = (fixture: string): string =>
  resolve(import.meta.dirname, "../fixtures", fixture, "tsconfig.json");

export const analyzeFixture = (
  fixture: string,
  fileFilter: string | null = null,
): ProjectAnalysis => analyzeProject(getFixtureConfig(fixture), fileFilter);

export const createTestBinding = (overrides: Partial<Binding>): Binding => ({
  id: 0,
  name: "value",
  kind: "state",
  hookKind: null,
  propName: null,
  loc: GeneratedSource,
  domain: { kind: "Unknown", reason: "unknown" },
  samples: [],
  initial: null,
  inputPlaces: [],
  lengthLimit: null,
  ...overrides,
});

export const createCapture = (overrides: Partial<Capture>): Capture => ({
  shapes: [],
  hookStates: [],
  probes: [],
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error: null,
  errorDepth: null,
  failure: null,
  ...overrides,
});

export const createTestAnalysis = (name: string, bindings: Binding[]): ComponentAnalysis => ({
  ...createEmptyAnalysis(
    {
      name,
      exportName: name,
      runtimeName: name,
      file: `/${name}.tsx`,
      declaration: `/${name}.tsx#${name}`,
    },
    GeneratedSource,
    { kind: "Primitive", value: null },
  ),
  bindings,
});

export const createTestReport = (places: Array<[BindingPlace, AbstractValue[]]>): StateReport => ({
  places: new PlaceMap(places),
  states: [],
  regions: [],
  unreachableBranches: [],
  isTruncated: false,
});

export const getComponent = (project: ProjectAnalysis, name: string): AnalyzedComponent => {
  const component = project.components.find((candidate) => candidate.analysis.name === name);
  if (!component) throw new Error(`No component named ${name}`);
  return component;
};

export const getBinding = (component: AnalyzedComponent, name: string): Binding => {
  const binding = component.analysis.bindings.find((candidate) => candidate.name === name);
  if (!binding) throw new Error(`No binding named ${name} in ${component.analysis.name}`);
  return binding;
};

export const getWarningKinds = (component: AnalyzedComponent): string[] =>
  component.analysis.warnings.map((warning) => warning.kind);

export const getHirFunctionsByName = (fixture: string): Map<string, HIRFunction> =>
  withProject(getFixtureConfig(fixture), (project) => {
    const functions = new Map<string, HIRFunction>();
    for (const fileName of project.program.getSourceFileNames().filter(isProjectSourceFile)) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
      for (const compiledFunction of compiled.functions) {
        if (compiledFunction.hir) functions.set(compiledFunction.name, compiledFunction.hir);
      }
    }
    return functions;
  });

export const getInstructions = (hirFunction: HIRFunction): Instruction[] =>
  [...hirFunction.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) =>
      isFunctionCreation(instruction.value)
        ? [instruction, ...getInstructions(instruction.value.loweredFunc.func)]
        : [instruction],
    ),
  );

export const getLocalTypesByName = (hirFunction: HIRFunction): Map<string, Type> =>
  new Map(
    getInstructions(hirFunction).flatMap((instruction) =>
      [...eachInstructionLValue(instruction)].flatMap((place) =>
        place.identifier.name ? [[place.identifier.name.value, place.identifier.type]] : [],
      ),
    ),
  );
