import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";
import type { types } from "@babel/core";
import type {
  AliasResolver,
  FileImports,
  ModuleExport,
  ModuleSummary,
  PackageImport,
} from "./types";

interface ExportBinding {
  local: string;
  exported: string;
}

const PARSER_PLUGINS: NonNullable<ParserOptions["plugins"]> = [
  "typescript",
  "jsx",
  "decorators-legacy",
];
const STORE_FACTORIES = new Set(["configureStore", "createStore", "legacy_createStore"]);
const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const DEFAULT_EXPORT = "default";
const RELATIVE_IMPORT_PATTERN = /^\.{1,2}\//;
const SOURCE_FILE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

export const parseBody = (code: string): types.Statement[] =>
  parse(code, { sourceType: "module", plugins: PARSER_PLUGINS, errorRecovery: true }).program.body;

const getName = (node: types.Identifier | types.StringLiteral): string =>
  node.type === "Identifier" ? node.name : node.value;

const getDeclaredNames = (node: types.Node | null | undefined): string[] => {
  if (node?.type === "VariableDeclaration")
    return node.declarations.flatMap((declarator) =>
      declarator.id.type === "Identifier" ? [declarator.id.name] : [],
    );
  if (
    node?.type === "FunctionDeclaration" ||
    node?.type === "ClassDeclaration" ||
    node?.type === "TSEnumDeclaration"
  )
    return node.id ? [node.id.name] : [];
  return [];
};

const getUnexportedDeclaration = (statement: types.Statement): types.Node | null | undefined =>
  statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

const getDefaultExportedName = (node: types.Node): string | null => {
  if (node.type === "Identifier") return node.name;
  if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id)
    return node.id.name;
  const [firstArgument] = node.type === "CallExpression" ? node.arguments : [];
  return firstArgument ? getDefaultExportedName(firstArgument) : null;
};

const getExportBindings = (statement: types.Statement): ExportBinding[] => {
  if (statement.type === "ExportDefaultDeclaration") {
    const local = getDefaultExportedName(statement.declaration);
    return local ? [{ local, exported: DEFAULT_EXPORT }] : [];
  }
  if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") return [];
  return [
    ...getDeclaredNames(statement.declaration).map((name) => ({ local: name, exported: name })),
    ...statement.specifiers.flatMap((specifier) =>
      specifier.type === "ExportSpecifier" && specifier.exportKind !== "type"
        ? [{ local: specifier.local.name, exported: getName(specifier.exported) }]
        : [],
    ),
  ];
};

const toComponentExport = (binding: ExportBinding): ModuleExport[] => {
  const name = binding.exported === DEFAULT_EXPORT ? binding.local : binding.exported;
  return COMPONENT_NAME_PATTERN.test(name) ? [{ name, exportName: binding.exported }] : [];
};

const getImport = (statement: types.Statement): PackageImport[] => {
  if (statement.type === "ImportDeclaration")
    return statement.importKind === "type"
      ? []
      : [
          {
            specifier: statement.source.value,
            names: statement.specifiers.flatMap((specifier) =>
              specifier.type === "ImportSpecifier" && specifier.importKind !== "type"
                ? [getName(specifier.imported)]
                : [],
            ),
          },
        ];
  if (statement.type === "ExportAllDeclaration")
    return statement.exportKind === "type"
      ? []
      : [{ specifier: statement.source.value, names: [] }];
  if (statement.type !== "ExportNamedDeclaration" || !statement.source) return [];
  return statement.exportKind === "type"
    ? []
    : [
        {
          specifier: statement.source.value,
          names: statement.specifiers.flatMap((specifier) =>
            specifier.type === "ExportSpecifier" && specifier.exportKind !== "type"
              ? [specifier.local.name]
              : [],
          ),
        },
      ];
};

const getTypeExportNames = (statement: types.Statement): string[] => {
  if (statement.type !== "ExportNamedDeclaration") return [];
  const declaration = statement.declaration;
  if (
    declaration?.type === "TSTypeAliasDeclaration" ||
    declaration?.type === "TSInterfaceDeclaration"
  )
    return [declaration.id.name];
  if (statement.exportKind !== "type") return [];
  return statement.specifiers.flatMap((specifier) =>
    specifier.type === "ExportSpecifier" ? [getName(specifier.exported)] : [],
  );
};

const getStoreNames = (statement: types.Statement): string[] => {
  const declaration = getUnexportedDeclaration(statement);
  if (declaration?.type !== "VariableDeclaration") return [];
  return declaration.declarations.flatMap((declarator) =>
    declarator.id.type === "Identifier" &&
    declarator.init?.type === "CallExpression" &&
    declarator.init.callee.type === "Identifier" &&
    STORE_FACTORIES.has(declarator.init.callee.name)
      ? [declarator.id.name]
      : [],
  );
};

const parseModuleBody = (code: string): types.Statement[] => {
  try {
    return parseBody(code);
  } catch {
    return [];
  }
};

export const summarizeModule = (code: string): ModuleSummary => {
  const body = parseModuleBody(code);
  const exportBindings = body.flatMap(getExportBindings);
  const valueNames = new Set(
    body.flatMap((statement) => getDeclaredNames(getUnexportedDeclaration(statement))),
  );
  const storeNames = new Set(body.flatMap(getStoreNames));
  return {
    exports: exportBindings.flatMap(toComponentExport),
    imports: body.flatMap(getImport),
    localNames: new Set(body.flatMap((statement) => getDeclaredNames(statement))),
    typeOnlyExports: new Set(
      body.flatMap(getTypeExportNames).filter((name) => !valueNames.has(name)),
    ),
    storeExportName:
      exportBindings.find((binding) => storeNames.has(binding.local))?.exported ?? null,
  };
};

export const getModuleSummary = (
  summaries: Map<string, ModuleSummary>,
  file: string,
): ModuleSummary => summaries.get(file) ?? summarizeModule(readFileSync(file, "utf8"));

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
  for (const packageImport of imports) {
    if (RELATIVE_IMPORT_PATTERN.test(packageImport.specifier)) {
      const resolved = resolveRelativeImport(file, packageImport.specifier);
      if (resolved) files.push(resolved);
      continue;
    }
    const aliased = await resolveAlias(packageImport.specifier, file);
    if (aliased) files.push(aliased);
    else packages.push({ specifier: packageImport.specifier, names: packageImport.names });
  }
  return { packages, files };
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
