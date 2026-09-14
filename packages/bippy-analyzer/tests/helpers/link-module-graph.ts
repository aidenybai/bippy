import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { SourceTextModule } from "node:vm";

const modules = new Map<string, SourceTextModule>();

const loadModule = (filename: string): SourceTextModule => {
  const cached = modules.get(filename);
  if (cached) return cached;
  const module = new SourceTextModule(readFileSync(filename, "utf8"), { identifier: filename });
  modules.set(filename, module);
  return module;
};

void loadModule(process.argv[2])
  .link((specifier, referringModule) => {
    if (!specifier.startsWith(".")) {
      return loadModule(createRequire(referringModule.identifier).resolve(specifier));
    }
    const filename = resolve(dirname(referringModule.identifier), specifier);
    return loadModule(extname(filename) ? filename : `${filename}.ts`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
