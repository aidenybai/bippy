import { resolve } from "node:path";
import { Command } from "commander";
import { isProjectSourceFile, withProject } from "../core/entrypoint/analyze-project.js";
import { findReactFunctions } from "../core/entrypoint/program.js";
import { runPipeline } from "../core/entrypoint/pipeline.js";
import { ScopeManager } from "../core/hir/scope.js";
import { printFunction } from "../core/hir/print-hir.js";

interface HirCliOptions {
  component?: string[];
  file?: string;
}

const run = (tsconfig: string, options: HirCliOptions): void =>
  withProject(resolve(tsconfig), (project) => {
    const fileNames = project.program
      .getSourceFileNames()
      .filter(
        (fileName) =>
          isProjectSourceFile(fileName) && (!options.file || fileName.includes(options.file)),
      );
    for (const fileName of fileNames) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const scopes = new ScopeManager(sourceFile);
      for (const reactFunction of findReactFunctions(sourceFile)) {
        if (options.component && !options.component.includes(reactFunction.name)) continue;
        const result = runPipeline(reactFunction, scopes);
        console.log(`// ${reactFunction.fnType} ${reactFunction.name}`);
        console.log(result.isOk() ? printFunction(result.unwrap()) : result.unwrapErr().toString());
        console.log();
      }
    }
  });

new Command()
  .name("hir")
  .description("Print the HIR of each component and hook after the compiler passes.")
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only print these functions")
  .option("-f, --file <filter>", "only files whose path contains this text")
  .action(run)
  .parse();
