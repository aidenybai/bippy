import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { parseSync } from "oxc-parser";
import type {
  ParsedSourceFile,
  SourceLanguage,
  SourceTransform,
  TransformedSource,
} from "../types.js";
import { readJsxPragma } from "./jsx-pragma.js";

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

const getParserLanguage = (lang: SourceLanguage): "js" | "jsx" | "ts" | "tsx" => {
  if (lang === "json") return "js";
  return lang === "js" ? "jsx" : lang;
};

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
    lang: getParserLanguage(lang),
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
    jsxPragma: lang === "json" ? null : readJsxPragma(result.comments),
  };
};

interface CacheEntry {
  mtimeMs: number;
  size: number;
  file: ParsedSourceFile;
}

export class SourceFileCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly transforms: SourceTransform[];

  constructor(transforms: SourceTransform[] = []) {
    this.transforms = transforms;
  }

  read(filePath: string): ParsedSourceFile | null {
    const lang = getSourceLanguage(filePath);
    const transform = this.findTransform(filePath, undefined);
    if (!lang && !transform) return null;
    return this.readCached(filePath, filePath, (fileText) =>
      lang ? { sourceText: fileText, lang } : transform?.transform(filePath, fileText),
    );
  }

  /** The module a `query` import of `filePath` links, when a transform is keyed on that query. */
  readQueried(filePath: string, query: string): ParsedSourceFile | null {
    const transform = this.findTransform(filePath, query);
    if (!transform) return null;
    return this.readCached(filePath, `${filePath}?${query}`, (fileText) =>
      transform.transform(filePath, fileText),
    );
  }

  private findTransform(filePath: string, query: string | undefined): SourceTransform | null {
    return (
      this.transforms.find(
        (candidate) => candidate.extension === extname(filePath) && candidate.query === query,
      ) ?? null
    );
  }

  private readCached(
    filePath: string,
    moduleKey: string,
    toSource: (fileText: string) => TransformedSource | null | undefined,
  ): ParsedSourceFile | null {
    const stats = statSync(filePath, { throwIfNoEntry: false });
    if (!stats || !stats.isFile()) return null;
    const cached = this.entries.get(moduleKey);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.file;
    }
    const source = toSource(readFileSync(filePath, "utf8"));
    if (!source) return null;
    const file = parseSourceText(moduleKey, source.sourceText, source.lang);
    this.entries.set(moduleKey, { mtimeMs: stats.mtimeMs, size: stats.size, file });
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
