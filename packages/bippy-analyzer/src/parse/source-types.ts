import type {
  ArrowFunctionExpression,
  Function as FunctionNode,
  Program,
  TSEnumDeclaration,
  TSGlobalDeclaration,
  TSModuleDeclaration,
} from "oxc-parser";

export type SourceLanguage = "js" | "jsx" | "ts" | "tsx" | "json";

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface ParsedSourceFile {
  filePath: string;
  lang: SourceLanguage;
  sourceText: string;
  program: Program;
  lineStarts: number[];
  errors: string[];
  /** `@jsx`/`@jsxFrag`/`@jsxRuntime`/`@jsxImportSource` comment annotations, when the file has any. */
  jsxPragma: JsxPragma | null;
}

export interface JsxPragma {
  runtime: "classic" | "automatic" | null;
  /** The classic-runtime element factory (`jsx`, `h`, `React.createElement`). */
  factory: string | null;
  fragment: string | null;
  importSource: string | null;
}

export interface TransformedSource {
  sourceText: string;
  lang: SourceLanguage;
}

/**
 * A bundler plugin the app configures, producing the module the bundler links
 * for a file (or for a `?query` import of it) in place of its text. `appliesTo`
 * picks the imports it sees by extension, by the language the parser reads the
 * file as (`null` for assets it cannot read itself) and by the import's query
 * (`react` for `icon.svg?react`, `null` for a plain import).
 */
export interface SourceTransform {
  appliesTo: (extension: string, lang: SourceLanguage | null, query: string | null) => boolean;
  transform: (
    filePath: string,
    sourceText: string,
    query: string | null,
  ) => TransformedSource | null;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  location: SourceLocation | null;
}

export type FunctionLikeNode = FunctionNode | ArrowFunctionExpression;

export type TypeScriptDeclaration = TSEnumDeclaration | TSModuleDeclaration | TSGlobalDeclaration;
