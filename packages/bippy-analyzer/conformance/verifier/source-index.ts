import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExportedName, FileImports, PackageImport } from "./types.js";

const IMPORT_PATTERN = /import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
const NAMED_IMPORTS_PATTERN = /\{([^}]*)\}/;
const EXPORT_DECLARATION_PATTERN =
  /export\s+(default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Z]\w*)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}/g;
const RELATIVE_SPECIFIER_PATTERN = /^\.{1,2}\//;
const SOURCE_FILE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

interface ParsedImport {
  specifier: string;
  names: string[];
}

const getImportedNames = (clause: string): string[] =>
  (NAMED_IMPORTS_PATTERN.exec(clause)?.[1]?.split(",") ?? []).flatMap((namedImport) => {
    if (/^\s*type\s/.test(namedImport)) return [];
    const name = namedImport.split(/\s+as\s+/)[0]?.trim();
    return name ? [name] : [];
  });

export const parseImports = (text: string): ParsedImport[] =>
  [...text.matchAll(IMPORT_PATTERN)].flatMap(([, typeOnly, clause = "", specifier = ""]) =>
    typeOnly ? [] : [{ specifier, names: getImportedNames(clause) }],
  );

export const parseExports = (text: string): Array<{ name: string; exportName: string }> => [
  ...[...text.matchAll(EXPORT_DECLARATION_PATTERN)].map(([, isDefault, name = ""]) => ({
    name,
    exportName: isDefault ? "default" : name,
  })),
  ...[...text.matchAll(EXPORT_LIST_PATTERN)].flatMap(([, names = ""]) =>
    names.split(",").flatMap((specifier) => {
      const exported = specifier
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      return exported && /^[A-Z]/.test(exported) ? [{ name: exported, exportName: exported }] : [];
    }),
  ),
];

const resolveRelativeImport = (file: string, specifier: string): string | null => {
  const base = resolve(dirname(file), specifier);
  return (
    SOURCE_FILE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
};

export const getFileImports = (file: string, imports: ParsedImport[]): FileImports => {
  const packages: PackageImport[] = [];
  const files: string[] = [];
  for (const { specifier, names } of imports) {
    if (!RELATIVE_SPECIFIER_PATTERN.test(specifier)) {
      packages.push({ specifier, names });
      continue;
    }
    const resolved = resolveRelativeImport(file, specifier);
    if (resolved) files.push(resolved);
  }
  return { packages, files };
};

export const addExports = (
  exports: Map<string, ExportedName[]>,
  file: string,
  text: string,
): void => {
  for (const { name, exportName } of parseExports(text))
    exports.set(name, [...(exports.get(name) ?? []), { file, exportName }]);
};
