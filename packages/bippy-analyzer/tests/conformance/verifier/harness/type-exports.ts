import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";
import type { types } from "@babel/core";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { isAppSourceModule, stripQuery } from "./packages";

const PARSER_PLUGINS: NonNullable<ParserOptions["plugins"]> = [
  "typescript",
  "jsx",
  "decorators-legacy",
];

const typeOnlyNamesByFile = new Map<string, Set<string>>();

const isTypeDeclaration = (node: types.Node | null | undefined): boolean =>
  node?.type === "TSTypeAliasDeclaration" || node?.type === "TSInterfaceDeclaration";

const getDeclaredName = (node: types.Node): string | null =>
  node.type === "TSTypeAliasDeclaration" ||
  node.type === "TSInterfaceDeclaration" ||
  node.type === "FunctionDeclaration" ||
  node.type === "ClassDeclaration" ||
  node.type === "TSEnumDeclaration"
    ? (node.id?.name ?? null)
    : null;

const getValueNames = (statement: types.Statement): string[] => {
  const declaration =
    statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (!declaration || isTypeDeclaration(declaration)) return [];
  if (declaration.type === "VariableDeclaration")
    return declaration.declarations.flatMap((declarator) =>
      declarator.id.type === "Identifier" ? [declarator.id.name] : [],
    );
  const name = getDeclaredName(declaration);
  return name ? [name] : [];
};

const getTypeExportNames = (statement: types.Statement): string[] => {
  if (statement.type !== "ExportNamedDeclaration") return [];
  const { declaration } = statement;
  if (declaration && isTypeDeclaration(declaration)) {
    const name = getDeclaredName(declaration);
    return name ? [name] : [];
  }
  if (statement.exportKind !== "type") return [];
  return statement.specifiers.flatMap((specifier) =>
    specifier.exported.type === "Identifier" ? [specifier.exported.name] : [],
  );
};

const parseBody = (code: string): types.Statement[] =>
  parse(code, { sourceType: "module", plugins: PARSER_PLUGINS, errorRecovery: true }).program.body;

const readTypeOnlyNames = (file: string): Set<string> => {
  const body = parseBody(readFileSync(file, "utf8"));
  const valueNames = new Set(body.flatMap(getValueNames));
  return new Set(body.flatMap(getTypeExportNames).filter((name) => !valueNames.has(name)));
};

export const getTypeOnlyNames = (file: string): Set<string> => {
  const cached = typeOnlyNamesByFile.get(file);
  if (cached) return cached;
  const names = readTypeOnlyNames(file);
  typeOnlyNamesByFile.set(file, names);
  return names;
};

const getLocalName = (specifier: types.ExportNamedDeclaration["specifiers"][number]): string => {
  if (specifier.type !== "ExportSpecifier") return "";
  return specifier.local.name;
};

const getReexportRewrite = (
  code: string,
  statement: types.ExportNamedDeclaration,
  typeOnlyNames: Set<string>,
): string | null => {
  const valueSpecifiers = statement.specifiers.filter(
    (specifier) => !typeOnlyNames.has(getLocalName(specifier)),
  );
  if (valueSpecifiers.length === statement.specifiers.length) return null;
  if (valueSpecifiers.length === 0) return "";
  const specifierText = valueSpecifiers
    .map((specifier) => code.slice(specifier.start ?? 0, specifier.end ?? 0))
    .join(", ");
  return `export { ${specifierText} } from ${JSON.stringify(statement.source?.value)};`;
};

export const removeTypeReexports = async (
  code: string,
  getSourceTypeNames: (specifier: string) => Promise<Set<string> | null>,
): Promise<MagicString | null> => {
  const source = new MagicString(code);
  for (const statement of parseBody(code)) {
    if (statement.type !== "ExportNamedDeclaration" || !statement.source) continue;
    const typeOnlyNames = await getSourceTypeNames(statement.source.value);
    const rewrite = typeOnlyNames && getReexportRewrite(code, statement, typeOnlyNames);
    if (typeof rewrite === "string")
      source.overwrite(statement.start ?? 0, statement.end ?? 0, rewrite);
  }
  return source.hasChanged() ? source : null;
};

export const createTypeReexportPlugin = (): Plugin => ({
  name: "bippy-verify-type-reexports",
  async transform(code, id) {
    if (!isAppSourceModule(id) || !code.includes("export {")) return null;
    const source = await removeTypeReexports(code, async (specifier) => {
      const resolved = await this.resolve(specifier, id);
      return resolved && isAppSourceModule(resolved.id)
        ? getTypeOnlyNames(stripQuery(resolved.id))
        : null;
    });
    return source && { code: source.toString(), map: source.generateMap({ hires: true }) };
  },
});
