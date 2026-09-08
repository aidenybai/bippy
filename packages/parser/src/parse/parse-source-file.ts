import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { parseSync } from "oxc-parser";
import type { ParsedSourceFile, SourceLanguage } from "../types.js";

const EXTENSION_TO_LANG: Record<string, SourceLanguage> = {
  ".js": "jsx",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx",
  ".mjs": "js",
  ".cjs": "js",
  ".mts": "ts",
  ".cts": "ts",
  ".json": "json",
};

// A JSON module is a CommonJS module whose `module.exports` is the document
// (Node, webpack, Vite and Next agree), so the default and top-level keys
// become its exports.
const JSON_MODULE_PREFIX = "module.exports = ";

export const SUPPORTED_SOURCE_EXTENSIONS = Object.keys(EXTENSION_TO_LANG);

export const getSourceLanguage = (filePath: string): SourceLanguage | null => {
  if (/\.d\.[cm]?ts$/.test(filePath)) return null;
  return EXTENSION_TO_LANG[extname(filePath)] ?? null;
};

const buildLineStarts = (sourceText: string): number[] => {
  const lineStarts = [0];
  let newlineIndex = sourceText.indexOf("\n");
  while (newlineIndex !== -1) {
    lineStarts.push(newlineIndex + 1);
    newlineIndex = sourceText.indexOf("\n", newlineIndex + 1);
  }
  return lineStarts;
};

export const parseSourceText = (
  filePath: string,
  sourceText: string,
  lang: SourceLanguage,
): ParsedSourceFile => {
  const programText = lang === "json" ? `${JSON_MODULE_PREFIX}${sourceText};` : sourceText;
  const result = parseSync(filePath, programText, {
    lang: lang === "json" ? "js" : lang,
    sourceType: "module",
    astType: lang === "ts" || lang === "tsx" ? "ts" : "js",
    preserveParens: false,
  });
  return {
    filePath,
    lang,
    sourceText: programText,
    program: result.program,
    lineStarts: buildLineStarts(programText),
    errors: result.errors
      .filter((error) => error.severity === "Error")
      .map((error) => error.message),
  };
};

interface CacheEntry {
  mtimeMs: number;
  size: number;
  file: ParsedSourceFile;
}

export class SourceFileCache {
  private readonly entries = new Map<string, CacheEntry>();

  read(filePath: string): ParsedSourceFile | null {
    const lang = getSourceLanguage(filePath);
    if (!lang) return null;
    const stats = statSync(filePath, { throwIfNoEntry: false });
    if (!stats || !stats.isFile()) return null;
    const cached = this.entries.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.file;
    }
    const sourceText = readFileSync(filePath, "utf8");
    const file = parseSourceText(filePath, sourceText, lang);
    this.entries.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, file });
    return file;
  }

  readVirtual(filePath: string, sourceText: string, lang: SourceLanguage): ParsedSourceFile {
    const file = parseSourceText(filePath, sourceText, lang);
    this.entries.set(filePath, { mtimeMs: -1, size: -1, file });
    return file;
  }

  get size(): number {
    return this.entries.size;
  }
}
