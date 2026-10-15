import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import type { types } from "@babel/core";
import type { Plugin } from "vite";
import { stripQuery } from "./packages";

const LOCAL_EXPORT_PREFIX = "__bippyLocal_";

export const toLocalExportName = (name: string): string => `${LOCAL_EXPORT_PREFIX}${name}`;

const getDeclaredNames = (statement: types.Statement): string[] => {
  if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration")
    return statement.id ? [statement.id.name] : [];
  if (statement.type !== "VariableDeclaration") return [];
  return statement.declarations.flatMap((declarator) =>
    declarator.id.type === "Identifier" ? [declarator.id.name] : [],
  );
};

export const getTopLevelNames = (file: string): Set<string> => {
  const program = parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy"],
    errorRecovery: true,
  }).program;
  return new Set(program.body.flatMap(getDeclaredNames));
};

const createLocalExportStatement = (names: string[]): string =>
  `\nexport { ${names.map((name) => `${name} as ${toLocalExportName(name)}`).join(", ")} };\n`;

export const createLocalExportPlugin = (localNamesByFile: Map<string, string[]>): Plugin => ({
  name: "bippy-verify-local-exports",
  transform: (code, id) => {
    const names = localNamesByFile.get(stripQuery(id));
    return names && names.length > 0 ? `${code}${createLocalExportStatement(names)}` : null;
  },
});
