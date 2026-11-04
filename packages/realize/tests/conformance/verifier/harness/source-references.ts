import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import type { ViteDevServer } from "vite";
import { appendToGroup } from "../../../../src/core/shared/append-to-group";
import { getFileImports, summarizeModule } from "../source-index";
import type {
  AliasResolver,
  ExportedName,
  FileImports,
  ModuleSummary,
  SourceIndex,
} from "../types";
import {
  PACKAGE_SPECIFIER_PATTERN,
  SOURCE_FILE_PATTERN,
  findPackageDirectory,
  getPackageName,
  stripQuery,
} from "./packages";

export interface SourceReferences {
  processEnv: Set<string>;
  importMetaEnv: Set<string>;
  nextFonts: Set<string>;
  packageImports: Map<string, Set<string>>;
  summaries: Map<string, ModuleSummary>;
  reduxStore: ExportedName | null;
}

const ENV_REFERENCE_PATTERN = /\b(process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const NEXT_FONT_SPECIFIERS = new Set(["next/font/google", "next/font/local"]);
const TEST_FILE_PATTERN = /\.(?:test|spec|stories)\.[jt]sx?$/;
const SUBPATH_IMPORT_PREFIX = "#";

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_FILE_PATTERN.test(entry.name) ? [path] : [];
  });

export const collectSourceReferences = (appDirectory: string): SourceReferences => {
  const references: SourceReferences = {
    processEnv: new Set(),
    importMetaEnv: new Set(),
    nextFonts: new Set(),
    packageImports: new Map(),
    summaries: new Map(),
    reduxStore: null,
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
    const summary = summarizeModule(text);
    references.summaries.set(file, summary);
    if (!references.reduxStore && summary.storeExportName && !TEST_FILE_PATTERN.test(file))
      references.reduxStore = { file, exportName: summary.storeExportName };
    for (const packageImport of summary.imports) {
      if (NEXT_FONT_SPECIFIERS.has(packageImport.specifier))
        for (const name of packageImport.names) references.nextFonts.add(name);
      if (!PACKAGE_SPECIFIER_PATTERN.test(packageImport.specifier)) continue;
      const packageNames = references.packageImports.get(packageImport.specifier) ?? new Set();
      for (const name of packageImport.names) packageNames.add(name);
      references.packageImports.set(packageImport.specifier, packageNames);
    }
    for (const [, source = "", name = ""] of text.matchAll(ENV_REFERENCE_PATTERN))
      (source === "process.env" ? references.processEnv : references.importMetaEnv).add(name);
  }
  return references;
};

const createAliasResolver = (server: ViteDevServer): AliasResolver => {
  const resolved = new Map<string, Promise<string | null>>();
  return (specifier: string, importer: string): Promise<string | null> => {
    const directory = dirname(importer);
    const key = `${directory}\0${specifier}`;
    const cached = resolved.get(key);
    if (cached) return cached;
    const isPackage =
      !specifier.startsWith(SUBPATH_IMPORT_PREFIX) &&
      findPackageDirectory(getPackageName(specifier), importer) !== null;
    const resolvedPath = isPackage
      ? Promise.resolve(null)
      : server.environments.client.pluginContainer
          .resolveId(specifier, importer)
          .then((partial) => {
            const id = partial ? stripQuery(partial.id) : undefined;
            return id &&
              isAbsolute(id) &&
              !id.includes(`${sep}node_modules${sep}`) &&
              existsSync(id)
              ? id
              : null;
          })
          .catch(() => null);
    resolved.set(key, resolvedPath);
    return resolvedPath;
  };
};

export const indexSource = async (
  references: SourceReferences,
  server: ViteDevServer,
): Promise<SourceIndex> => {
  const resolveAlias = createAliasResolver(server);
  const exports = new Map<string, ExportedName[]>();
  const imports = new Map<string, FileImports>();
  for (const [file, summary] of references.summaries) {
    for (const moduleExport of summary.exports)
      appendToGroup(exports, moduleExport.name, { file, exportName: moduleExport.exportName });
    imports.set(file, await getFileImports(file, summary.imports, resolveAlias));
  }
  return { exports, imports };
};
