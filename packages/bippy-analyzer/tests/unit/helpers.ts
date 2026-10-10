import { resolve } from "node:path";
import { isProjectSourceFile, withProject } from "../../src/core/entrypoint/analyze-project.js";
import { runPipeline } from "../../src/core/entrypoint/pipeline.js";
import { findReactFunctions } from "../../src/core/entrypoint/program.js";
import type { HIRFunction, Instruction, Type } from "../../src/core/hir/hir.js";
import { ScopeManager } from "../../src/core/hir/scope.js";
import { eachInstructionLValue } from "../../src/core/hir/visitors.js";
import type {
  AnalyzedComponent,
  Binding,
  ProjectAnalysis,
} from "../../src/core/inference/types.js";

export const getFixtureConfig = (fixture: string): string =>
  resolve(import.meta.dirname, "fixtures", fixture, "tsconfig.json");

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

/**
 * Runs the compiler pipeline on every component and hook in a fixture project and keeps
 * the HIR by function name.
 */
export const lowerProject = (fixture: string): Map<string, HIRFunction> =>
  withProject(getFixtureConfig(fixture), (project) => {
    const functions = new Map<string, HIRFunction>();
    for (const fileName of project.program.getSourceFileNames().filter(isProjectSourceFile)) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const scopes = new ScopeManager(sourceFile);
      for (const reactFunction of findReactFunctions(sourceFile)) {
        const result = runPipeline(reactFunction, {
          sourceFile,
          checker: project.checker,
          scopes,
        });
        if (result.isOk()) functions.set(reactFunction.name, result.unwrap());
      }
    }
    return functions;
  });

/**
 * Every instruction of a function, including those of the functions it creates.
 */
export const getInstructions = (fn: HIRFunction): Instruction[] =>
  [...fn.body.blocks.values()].flatMap((block) =>
    block.instructions.flatMap((instruction) =>
      instruction.value.kind === "FunctionExpression" || instruction.value.kind === "ObjectMethod"
        ? [instruction, ...getInstructions(instruction.value.loweredFunc.func)]
        : [instruction],
    ),
  );

/**
 * The type of each named local a function declares, by source name.
 */
export const getNamedTypes = (fn: HIRFunction): Map<string, Type> =>
  new Map(
    getInstructions(fn).flatMap((instruction) =>
      eachInstructionLValue(instruction).flatMap((place) =>
        place.identifier.name ? [[place.identifier.name.value, place.identifier.type]] : [],
      ),
    ),
  );
