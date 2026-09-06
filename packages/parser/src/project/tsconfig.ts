import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Expression } from "@oxc-project/types";
import { parseSync } from "oxc-parser";

export interface TsconfigPathMapping {
  /** oxc-resolver aliases derived from `compilerOptions.paths`, with absolute targets. */
  alias: Record<string, string[]>;
  /** Absolute `compilerOptions.baseUrl`; bare specifiers also resolve from here. */
  baseUrl: string | null;
}

const EMPTY_MAPPING: TsconfigPathMapping = { alias: {}, baseUrl: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Folds the literal expression a JSON document parses to back into data. */
const foldLiteral = (node: Expression): unknown => {
  switch (node.type) {
    case "ObjectExpression": {
      const record: Record<string, unknown> = {};
      for (const property of node.properties) {
        if (property.type !== "Property") continue;
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal"
              ? String(property.key.value)
              : null;
        if (key !== null) record[key] = foldLiteral(property.value);
      }
      return record;
    }
    case "ArrayExpression":
      return node.elements.map((element) =>
        element === null || element.type === "SpreadElement" ? undefined : foldLiteral(element),
      );
    case "Literal":
      return node.value;
    case "ParenthesizedExpression":
      return foldLiteral(node.expression);
    case "UnaryExpression":
      return node.operator === "-" && node.argument.type === "Literal"
        ? -Number(node.argument.value)
        : undefined;
    default:
      return undefined;
  }
};

/**
 * tsconfig files are JSON with comments and trailing commas, which is a JS
 * expression; oxc's parser reads it without a second grammar.
 */
export const readJsonWithComments = (filePath: string): unknown => {
  const { program, errors } = parseSync("config.js", `(${readFileSync(filePath, "utf8")})`);
  const [statement] = program.body;
  if (errors.length > 0 || statement?.type !== "ExpressionStatement") return undefined;
  return foldLiteral(statement.expression);
};

/** TypeScript matches a `paths` key without `*` exactly; oxc needs `$` to say the same. */
const toAliasKey = (pattern: string): string => (pattern.includes("*") ? pattern : `${pattern}$`);

/**
 * Path mapping declared by one tsconfig, ignoring `extends`. This stands in
 * for oxc's own tsconfig support when the extended config cannot be loaded,
 * typically because it lives in a workspace package that is not installed.
 */
export const readTsconfigPaths = (tsconfigPath: string): TsconfigPathMapping => {
  const config = readJsonWithComments(tsconfigPath);
  if (!isRecord(config) || !isRecord(config.compilerOptions)) return EMPTY_MAPPING;
  const { baseUrl, paths } = config.compilerOptions;
  const directory = dirname(tsconfigPath);
  const absoluteBaseUrl = typeof baseUrl === "string" ? resolve(directory, baseUrl) : null;
  const alias: Record<string, string[]> = {};
  if (isRecord(paths)) {
    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue;
      alias[toAliasKey(pattern)] = targets
        .filter((target): target is string => typeof target === "string")
        .map((target) => resolve(absoluteBaseUrl ?? directory, target));
    }
  }
  return { alias, baseUrl: absoluteBaseUrl };
};
