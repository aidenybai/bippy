import { resolve } from "node:path";
import { CompilerTypeProvider } from "../src/core/type-provider.js";
import { isProjectSourceFile, withProject } from "../src/core/utils/with-project.js";
import { compileFile } from "../src/core/compile.js";
import type { HIRFunction, Instruction, Type } from "../src/react-compiler/HIR/HIR.js";
import { eachInstructionLValue } from "../src/react-compiler/HIR/visitors.js";
import type { AnalyzedComponent, Binding, ProjectAnalysis } from "../src/core/types.js";

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
      const compiled = compileFile(fileName, sourceFile.text, {
        typeProvider: new CompilerTypeProvider(project.checker, sourceFile),
      });
      for (const compiledFunction of compiled.functions) {
        if (compiledFunction.hir) functions.set(compiledFunction.name, compiledFunction.hir);
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
      [...eachInstructionLValue(instruction)].flatMap((place) =>
        place.identifier.name ? [[place.identifier.name.value, place.identifier.type]] : [],
      ),
    ),
  );
