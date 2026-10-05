import { existsSync, readFileSync } from "node:fs";
import type { Expression } from "@oxc-project/types";
import { parseSync } from "oxc-parser";
import { z } from "zod";
import { getCompilerConfigFile, type ModuleResolver } from "./module-resolver.js";

/**
 * The project-wide JSX transform settings the bundler reads from the TypeScript
 * (or `jsconfig.json`) compiler options: Next's SWC loader compiles every app
 * file with `compilerOptions.jsxImportSource`, and Vite's esbuild pass takes it
 * from the tsconfig a `.tsx` file belongs to. A file's own `@jsx*` annotations
 * override them.
 */
export interface ProjectJsxOptions {
  importSource: string;
}

const JSON_EXTENSION = ".json";

const COMPILER_CONFIG = z.object({
  extends: z.union([z.string(), z.array(z.string())]).optional(),
  compilerOptions: z.object({ jsxImportSource: z.string().optional() }).optional(),
});

interface CompilerConfig extends z.infer<typeof COMPILER_CONFIG> {}

/** tsconfig is JSON with comments and trailing commas, which oxc reads as a JavaScript literal. */
const readJsonLiteral = (node: Expression): unknown => {
  switch (node.type) {
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties.flatMap((property) => {
          if (property.type !== "Property") return [];
          const { key } = property;
          const name =
            key.type === "Identifier"
              ? key.name
              : key.type === "Literal"
                ? String(key.value)
                : null;
          return name === null ? [] : [[name, readJsonLiteral(property.value)]];
        }),
      );
    case "ArrayExpression":
      return node.elements.map((element) =>
        element === null || element.type === "SpreadElement" ? null : readJsonLiteral(element),
      );
    case "Literal":
      return node.value;
    case "UnaryExpression":
      return node.operator === "-" && node.argument.type === "Literal"
        ? -Number(node.argument.value)
        : null;
    default:
      return null;
  }
};

const readCompilerConfig = (configPath: string): CompilerConfig | null => {
  const text = readFileSync(configPath, "utf8");
  if (text.trim() === "") return {};
  const { program, errors } = parseSync(configPath, `(${text})`, {
    lang: "js",
    preserveParens: false,
  });
  const statement = program.body[0];
  if (errors.length > 0 || statement?.type !== "ExpressionStatement") return null;
  const parsed = COMPILER_CONFIG.safeParse(readJsonLiteral(statement.expression));
  return parsed.success ? parsed.data : null;
};

/** `extends` names a file, a path with the `.json` left off, or a package's config (`@tsconfig/next/tsconfig.json`). */
const resolveExtendedConfig = (
  specifier: string,
  fromConfig: string,
  resolver: ModuleResolver,
): string | null => {
  const candidates = specifier.endsWith(JSON_EXTENSION)
    ? [specifier]
    : [specifier, `${specifier}${JSON_EXTENSION}`];
  for (const candidate of candidates) {
    const resolution = resolver.resolve(candidate, fromConfig, "commonjs");
    if (resolution.kind === "internal") return resolution.filePath;
    if (resolution.kind === "external" && resolution.filePath !== null) return resolution.filePath;
  }
  return null;
};

/** `jsxImportSource` as TypeScript resolves it: the nearest config in the `extends` chain that sets it (later `extends` entries win over earlier ones). */
const readJsxImportSource = (
  configPath: string,
  resolver: ModuleResolver,
  visited: Set<string>,
): string | null => {
  if (visited.has(configPath)) return null;
  visited.add(configPath);
  const config = readCompilerConfig(configPath);
  if (config === null) return null;
  const own = config.compilerOptions?.jsxImportSource;
  if (own !== undefined) return own;
  const bases =
    typeof config.extends === "string" ? [config.extends] : (config.extends ?? []).toReversed();
  for (const base of bases) {
    const basePath = resolveExtendedConfig(base, configPath, resolver);
    const inherited = basePath === null ? null : readJsxImportSource(basePath, resolver, visited);
    if (inherited !== null) return inherited;
  }
  return null;
};

/** The project's JSX options from `tsconfigPath`, or the sibling `jsconfig.json` a JavaScript project keeps instead; `null` when neither sets any. */
export const readProjectJsxOptions = (
  tsconfigPath: string,
  resolver: ModuleResolver,
): ProjectJsxOptions | null => {
  const configPath = getCompilerConfigFile(tsconfigPath);
  if (!existsSync(configPath)) return null;
  const importSource = readJsxImportSource(configPath, resolver, new Set());
  return importSource === null ? null : { importSource };
};
