import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendToGroup } from "../../../src/core/utils/append-to-group";
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
    appendToGroup(exports, name, { file, exportName });
};

interface SearchFrame {
  file: string;
  nextIndex: number;
}

class ImportCycleFinder {
  readonly #imports: Map<string, FileImports>;
  readonly #indices = new Map<string, number>();
  readonly #lowLinks = new Map<string, number>();
  readonly #stack: string[] = [];
  readonly #onStack = new Set<string>();
  readonly #cycles: string[][] = [];

  constructor(imports: Map<string, FileImports>) {
    this.#imports = imports;
  }

  findCycles(): string[][] {
    for (const root of this.#imports.keys()) if (!this.#indices.has(root)) this.#search(root);
    return this.#cycles;
  }

  #search(root: string): void {
    this.#enter(root);
    const frames: SearchFrame[] = [{ file: root, nextIndex: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const target = this.#imports.get(frame.file)?.files[frame.nextIndex++];
      if (target === undefined) {
        frames.pop();
        this.#finish(frame.file, frames.at(-1)?.file ?? null);
      } else if (!this.#indices.has(target)) {
        this.#enter(target);
        frames.push({ file: target, nextIndex: 0 });
      } else if (this.#onStack.has(target)) {
        this.#lowerLink(frame.file, this.#indices.get(target) ?? Infinity);
      }
    }
  }

  #enter(file: string): void {
    this.#indices.set(file, this.#indices.size);
    this.#lowLinks.set(file, this.#indices.size - 1);
    this.#stack.push(file);
    this.#onStack.add(file);
  }

  #getLowLink(file: string): number {
    return this.#lowLinks.get(file) ?? Infinity;
  }

  #lowerLink(file: string, candidate: number): void {
    this.#lowLinks.set(file, Math.min(this.#getLowLink(file), candidate));
  }

  #finish(file: string, parentFile: string | null): void {
    if (parentFile !== null) this.#lowerLink(parentFile, this.#getLowLink(file));
    if (this.#getLowLink(file) !== this.#indices.get(file)) return;
    const cycle = this.#stack.splice(this.#stack.indexOf(file));
    for (const cycleFile of cycle) this.#onStack.delete(cycleFile);
    if (cycle.length > 1) this.#cycles.push(cycle);
  }
}

export const getCycleImporters = (imports: Map<string, FileImports>): Map<string, string[]> =>
  new Map(
    new ImportCycleFinder(imports)
      .findCycles()
      .flatMap((cycle) =>
        cycle.map((file): [string, string[]] => [
          file,
          cycle.filter((importer) => imports.get(importer)?.files.includes(file)),
        ]),
      ),
  );
