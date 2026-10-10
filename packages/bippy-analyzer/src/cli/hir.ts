import { dirname, resolve, sep } from "node:path";
import { Command } from "commander";
import { API } from "typescript/unstable/sync";
import { findReactFunctions } from "../core/entrypoint/program.js";
import { runPipeline } from "../core/entrypoint/pipeline.js";
import { ScopeManager } from "../core/hir/scope.js";
import { printFunction } from "../core/hir/print-hir.js";

interface HirCliOptions {
  component?: string[];
  file?: string;
}

const run = (tsconfig: string, options: HirCliOptions): void => {
  const configPath = resolve(tsconfig);
  const api = new API({ cwd: dirname(configPath) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
    const fileNames = project.program
      .getSourceFileNames()
      .filter(
        (fileName) =>
          !fileName.includes(`${sep}node_modules${sep}`) &&
          !fileName.endsWith(".d.ts") &&
          /\.[jt]sx?$/.test(fileName),
      )
      .filter((fileName) => !options.file || fileName.includes(options.file));
    for (const fileName of fileNames) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const scopes = new ScopeManager(sourceFile);
      for (const reactFunction of findReactFunctions(sourceFile)) {
        if (options.component && !options.component.includes(reactFunction.name)) continue;
        const result = runPipeline(reactFunction, { scopes, sourceFile, checker: project.checker });
        console.log(`// ${reactFunction.fnType} ${reactFunction.name}`);
        console.log(result.isOk() ? printFunction(result.unwrap()) : result.unwrapErr().toString());
        console.log();
      }
    }
  } finally {
    api.close();
  }
};

new Command()
  .name("hir")
  .description("Print the HIR of each component and hook after the compiler passes.")
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only print these functions")
  .option("-f, --file <filter>", "only files whose path contains this text")
  .action(run)
  .parse();
