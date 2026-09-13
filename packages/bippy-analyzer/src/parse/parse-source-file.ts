import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { parseSync } from "oxc-parser";
import type { Comment } from "oxc-parser";
import type {
  JsxPragma,
  ParsedSourceFile,
  SourceLanguage,
  SourceTransform,
  TransformedSource,
} from "../types.js";
import type { ProjectJsxOptions } from "../graph/jsx-compiler-options.js";
import { isInsideNodeModules } from "../graph/module-resolver.js";
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

/** The file's own annotations over the project's compiler options; `importSource` is what the automatic runtime imports from when the file names none. */
const readProjectJsxPragma = (
  comments: readonly Comment[],
  projectJsx: ProjectJsxOptions | null,
): JsxPragma | null => {
  const own = readJsxPragma(comments);
  if (projectJsx === null || own?.importSource) return own;
  return {
    runtime: null,
    factory: null,
    fragment: null,
    ...own,
    importSource: projectJsx.importSource,
  };
};

export const parseSourceText = (
  filePath: string,
  sourceText: string,
  lang: SourceLanguage,
  projectJsx: ProjectJsxOptions | null = null,
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
    jsxPragma: lang === "json" ? null : readProjectJsxPragma(result.comments, projectJsx),
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
  private readonly projectJsx: ProjectJsxOptions | null;

  constructor(transforms: SourceTransform[] = [], projectJsx: ProjectJsxOptions | null = null) {
    this.transforms = transforms;
    this.projectJsx = projectJsx;
  }

  read(filePath: string): ParsedSourceFile | null {
    return this.readTransformed(filePath, null);
  }

  /** The module a `query` import of `filePath` links, when a transform claims that query. */
  readQueried(filePath: string, query: string): ParsedSourceFile | null {
    return this.readTransformed(filePath, query);
  }

  private readTransformed(filePath: string, query: string | null): ParsedSourceFile | null {
    const lang = getSourceLanguage(filePath);
    const extension = extname(filePath);
    const transforms = this.transforms.filter((candidate) =>
      candidate.appliesTo(extension, lang, query),
    );
    if (!lang && transforms.length === 0) return null;
    const stats = statSync(filePath, { throwIfNoEntry: false });
    if (!stats || !stats.isFile()) return null;
    const moduleKey = query === null ? filePath : `${filePath}?${query}`;
    const cached = this.entries.get(moduleKey);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.file;
    }
    const fileText = readFileSync(filePath, "utf8");
    const transformed = transforms.reduce<TransformedSource | null>(
      (previous, candidate) =>
        candidate.transform(filePath, previous?.sourceText ?? fileText, query) ?? previous,
      null,
    );
    const source = transformed ?? (lang && query === null ? { sourceText: fileText, lang } : null);
    if (!source) return null;
    const file = parseSourceText(
      moduleKey,
      source.sourceText,
      source.lang,
      isInsideNodeModules(filePath) ? null : this.projectJsx,
    );
    this.entries.set(moduleKey, { mtimeMs: stats.mtimeMs, size: stats.size, file });
    return file;
  }

  readVirtual(filePath: string, sourceText: string, lang: SourceLanguage): ParsedSourceFile {
    const file = parseSourceText(filePath, sourceText, lang);
    this.entries.set(filePath, { mtimeMs: -1, size: -1, file });
    return file;
  }
}
