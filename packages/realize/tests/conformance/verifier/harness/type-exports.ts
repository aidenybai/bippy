import type { types } from "@babel/core";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { getModuleSummary, parseBody } from "../source-index";
import type { ModuleSummary } from "../types";
import { isAppSourceModule, stripQuery } from "./packages";

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

export const createTypeReexportPlugin = (summaries: Map<string, ModuleSummary>): Plugin => ({
  name: "bippy-verify-type-reexports",
  async transform(code, id) {
    if (!isAppSourceModule(id) || !code.includes("export {")) return null;
    const source = await removeTypeReexports(code, async (specifier) => {
      const resolved = await this.resolve(specifier, id);
      return resolved && isAppSourceModule(resolved.id)
        ? getModuleSummary(summaries, stripQuery(resolved.id)).typeOnlyExports
        : null;
    });
    return source && { code: source.toString(), map: source.generateMap({ hires: true }) };
  },
});
