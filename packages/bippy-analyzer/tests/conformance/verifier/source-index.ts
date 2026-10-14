import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AliasResolver,
  ExportedName,
  FileImports,
  ModuleExport,
  PackageImport,
} from "./types";

const IMPORT_PATTERN = /import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
const REEXPORT_PATTERN =
  /export\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
const NAMED_IMPORTS_PATTERN = /\{([^}]*)\}/;
const EXPORT_DECLARATION_PATTERN =
  /export\s+(default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Z]\w*)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}/g;
const RELATIVE_IMPORT_PATTERN = /^\.{1,2}\//;
const SOURCE_FILE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

const getImportedNames = (clause: string): string[] =>
  (NAMED_IMPORTS_PATTERN.exec(clause)?.[1]?.split(",") ?? []).flatMap((namedImport) => {
    if (/^\s*type\s/.test(namedImport)) return [];
    const name = namedImport.split(/\s+as\s+/)[0]?.trim();
    return name ? [name] : [];
  });

export const parseImports = (text: string): PackageImport[] =>
  [...text.matchAll(IMPORT_PATTERN), ...text.matchAll(REEXPORT_PATTERN)].flatMap(
    ([, typeOnly, clause = "", specifier = ""]) =>
      typeOnly ? [] : [{ specifier, names: getImportedNames(clause) }],
  );

export const parseExports = (text: string): ModuleExport[] => [
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

export const getFileImports = async (
  file: string,
  imports: PackageImport[],
  resolveAlias: AliasResolver,
): Promise<FileImports> => {
  const packages: PackageImport[] = [];
  const files: string[] = [];
  for (const { specifier, names } of imports) {
    if (RELATIVE_IMPORT_PATTERN.test(specifier)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved) files.push(resolved);
      continue;
    }
    const aliased = await resolveAlias(specifier, file);
    if (aliased) files.push(aliased);
    else packages.push({ specifier, names });
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

export const getCycleImporters = (imports: Map<string, FileImports>): Map<string, string[]> => {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const getLowLink = (file: string): number => lowLinks.get(file) ?? Infinity;
  const enter = (file: string): void => {
    indices.set(file, indices.size);
    lowLinks.set(file, indices.size - 1);
    stack.push(file);
    onStack.add(file);
  };
  for (const root of imports.keys()) {
    if (indices.has(root)) continue;
    enter(root);
    const frames = [{ file: root, nextIndex: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const target = imports.get(frame.file)?.files[frame.nextIndex++];
      if (target !== undefined) {
        if (!indices.has(target)) {
          enter(target);
          frames.push({ file: target, nextIndex: 0 });
        } else if (onStack.has(target)) {
          lowLinks.set(
            frame.file,
            Math.min(getLowLink(frame.file), indices.get(target) ?? Infinity),
          );
        }
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent)
        lowLinks.set(parent.file, Math.min(getLowLink(parent.file), getLowLink(frame.file)));
      if (getLowLink(frame.file) !== indices.get(frame.file)) continue;
      const cycle = stack.splice(stack.indexOf(frame.file));
      for (const file of cycle) onStack.delete(file);
      if (cycle.length > 1) cycles.push(cycle);
    }
  }
  return new Map(
    cycles.flatMap((cycle) =>
      cycle.map((file): [string, string[]] => [
        file,
        cycle.filter((importer) => imports.get(importer)?.files.includes(file)),
      ]),
    ),
  );
};
