import { dirname, relative, resolve } from "node:path";
import { Command } from "commander";
import { TlaError } from "tla-ts";
import { analyzeProject } from "../core/analyze-project";
import { ConfigError } from "../core/config-error";
import {
  checkSpec,
  createComponentModuleResolver,
  findSpecFiles,
  formatSpecCheck,
} from "./tla-specs";

const runCheckSpecs = (tsconfig: string): void => {
  const configPath = resolve(tsconfig);
  const rootDirectory = dirname(configPath);
  const { components } = analyzeProject(configPath);
  const resolveComponentModule = createComponentModuleResolver(components, rootDirectory);
  for (const specFile of findSpecFiles(rootDirectory)) {
    try {
      const specCheck = checkSpec(specFile, resolveComponentModule);
      if (!specCheck) continue;
      console.log(formatSpecCheck(specCheck, rootDirectory));
      if (specCheck.result.status !== "success") process.exitCode = 1;
    } catch (error) {
      if (!(error instanceof ConfigError || error instanceof TlaError)) throw error;
      console.error(`${relative(rootDirectory, specFile)}: ${error.message}`);
      process.exitCode = 1;
    }
  }
};

new Command()
  .name("check-specs")
  .description(
    "Check each TLA+ spec in the project that extends or instances a component against that component's model.",
  )
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .action((tsconfig: string) => runCheckSpecs(tsconfig))
  .parse();
