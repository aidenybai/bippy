import { extname } from "node:path";
import { parseSync, type ParserOptions } from "oxc-parser";
import { collectModuleTables } from "./bindings.js";
import { createLineIndex } from "./location.js";
import type { ModuleEnvironment, ParsedModule } from "./types.js";

const LANGUAGE_BY_EXTENSION: Record<string, ParserOptions["lang"]> = {
  ".js": "jsx",
  ".mjs": "jsx",
  ".cjs": "jsx",
  ".jsx": "jsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

export const SOURCE_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION);

export const isSourceFilePath = (filePath: string): boolean =>
  extname(filePath).toLowerCase() in LANGUAGE_BY_EXTENSION && !filePath.endsWith(".d.ts");

const getEnvironment = (directives: string[]): ModuleEnvironment => {
  if (directives.includes("use client")) return "client";
  if (directives.includes("use server")) return "server";
  return "shared";
};

/**
 * Parses a module with oxc and derives the binding and export tables the
 * linker needs. Parse errors are recorded, not thrown: oxc recovers into a
 * partial AST which is still useful for analysis.
 */
export const parseModule = (filePath: string, sourceText: string): ParsedModule => {
  const extension = extname(filePath).toLowerCase();
  const result = parseSync(filePath, sourceText, {
    lang: LANGUAGE_BY_EXTENSION[extension] ?? "tsx",
    sourceType: "unambiguous",
  });
  const directives: string[] = [];
  for (const statement of result.program.body) {
    if (!("directive" in statement) || typeof statement.directive !== "string") break;
    directives.push(statement.directive);
  }
  const { bindings, exports } = collectModuleTables(result.program);
  return {
    filePath,
    sourceText,
    program: result.program,
    esm: result.module,
    errors: result.errors,
    directives,
    environment: getEnvironment(directives),
    lineIndex: createLineIndex(sourceText),
    bindings,
    exports,
  };
};
