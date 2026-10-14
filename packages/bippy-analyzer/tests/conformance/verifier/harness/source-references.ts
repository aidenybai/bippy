import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import type { ViteDevServer } from "vite";
import { addExports, getFileImports, parseImports } from "../source-index";
import type {
  AliasResolver,
  ExportedName,
  FileImports,
  PackageImport,
  SourceIndex,
} from "../types";
import {
  PACKAGE_SPECIFIER_PATTERN,
  SOURCE_FILE_PATTERN,
  getPackageName,
  hasPackageDirectory,
  stripQuery,
} from "./packages";

export interface SourceReferences {
  processEnv: Set<string>;
  importMetaEnv: Set<string>;
  nextFonts: Set<string>;
  packageImports: Map<string, Set<string>>;
  exports: SourceIndex["exports"];
  fileImports: Map<string, PackageImport[]>;
  reduxStore: ExportedName | null;
}

const ENV_REFERENCE_PATTERN = /\b(process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const NEXT_FONT_IMPORT_PATTERN =
  /import\s+(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["']/g;
const STORE_DECLARATION_PATTERN =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:configureStore|createStore|legacy_createStore)\(/;
const TEST_FILE_PATTERN = /\.(?:test|spec|stories)\.[jt]sx?$/;

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_FILE_PATTERN.test(entry.name) ? [path] : [];
  });

const findReduxStore = (file: string, text: string): ExportedName | null => {
  const name = STORE_DECLARATION_PATTERN.exec(text)?.[1];
  if (!name) return null;
  if (new RegExp(`export\\s+default\\s+${name}\\b`).test(text))
    return { file, exportName: "default" };
  return new RegExp(`export\\s+(?:const|let)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(
    text,
  )
    ? { file, exportName: name }
    : null;
};

export const collectSourceReferences = (appDirectory: string): SourceReferences => {
  const references: SourceReferences = {
    processEnv: new Set(),
    importMetaEnv: new Set(),
    nextFonts: new Set(),
    packageImports: new Map(),
    exports: new Map(),
    fileImports: new Map(),
    reduxStore: null,
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
    if (!references.reduxStore && !TEST_FILE_PATTERN.test(file))
      references.reduxStore = findReduxStore(file, text);
    addExports(references.exports, file, text);
    const imports = parseImports(text);
    references.fileImports.set(file, imports);
    for (const { specifier, names } of imports) {
      if (!PACKAGE_SPECIFIER_PATTERN.test(specifier)) continue;
      const packageNames = references.packageImports.get(specifier) ?? new Set();
      for (const name of names) packageNames.add(name);
      references.packageImports.set(specifier, packageNames);
    }
    for (const [, source = "", name = ""] of text.matchAll(ENV_REFERENCE_PATTERN))
      (source === "process.env" ? references.processEnv : references.importMetaEnv).add(name);
    for (const [, names = ""] of text.matchAll(NEXT_FONT_IMPORT_PATTERN))
      for (const name of names.split(",")) {
        const localName = name.split(/\s+as\s+/)[0]?.trim();
        if (localName) references.nextFonts.add(localName);
      }
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
    const resolvedPath = hasPackageDirectory(directory, getPackageName(specifier))
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
  const imports = new Map<string, FileImports>();
  for (const [file, fileImports] of references.fileImports)
    imports.set(file, await getFileImports(file, fileImports, resolveAlias));
  return { exports: references.exports, imports };
};
