import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompilerTypeProvider } from "../../src/core/type-checker/type-provider";
import { isProjectSourceFile } from "../../src/core/project/is-project-source-file";
import { withProject } from "../../src/core/project/with-project";
import { compileFile } from "../../src/core/compile/compile";
import { interpretProject, reportProject } from "../../src/core/project/analyze-project";
import type { InterpretedProject } from "../../src/core/project/analyze-project";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import type { HIRFunction, Instruction, Type } from "../../src/react-compiler/HIR/HIR";
import { eachInstructionLValue } from "../../src/react-compiler/HIR/visitors";
import { isFunctionCreation } from "../../src/core/interpret/is-function-creation";
import type { AnalyzedComponent, Binding, ProjectAnalysis } from "../../src/core/types";
import { collectHandlerCounters } from "../conformance/verifier/handler-counters";
import type { Capture } from "../conformance/verifier/types";

export const getFixtureConfig = (fixture: string): string =>
  resolve(import.meta.dirname, "../fixtures", fixture, "tsconfig.json");

const interpretedFixtures = new Map<string, InterpretedProject>();

export const analyzeFixture = (
  fixture: string,
  fileFilter: string | null = null,
): Promise<ProjectAnalysis> => {
  const interpreted =
    interpretedFixtures.get(fixture) ?? interpretProject(getFixtureConfig(fixture));
  interpretedFixtures.set(fixture, interpreted);
  return reportProject(interpreted, fileFilter);
};

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
  isDerived: false,
  ...overrides,
});

export const createCapture = (overrides: Partial<Capture>): Capture => ({
  shapes: [],
  stateValues: [],
  branchHits: [],
  handlerCalls: [],
  mutationHits: [],
  mutatedOrigins: [],
  error: null,
  errorDepth: null,
  failure: null,
  ...overrides,
});

export const getComponent = (project: ProjectAnalysis, name: string): AnalyzedComponent => {
  const component = project.components.find((candidate) => candidate.analysis.name === name);
  if (!component) throw new Error(`No component named ${name}`);
  return component;
};

export const getHandlerCounterId = (
  component: AnalyzedComponent,
  handlerSource: string,
): string => {
  const matching = collectHandlerCounters(component.analysis).filter(({ counter }) =>
    readFileSync(counter.file, "utf8").slice(counter.start, counter.end).startsWith(handlerSource),
  );
  const [handlerCounter] = matching;
  if (!handlerCounter || matching.length > 1)
    throw new Error(
      `${matching.length} handlers start with ${handlerSource} in ${component.analysis.name}`,
    );
  return handlerCounter.counter.id;
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
