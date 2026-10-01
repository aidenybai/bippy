import type {
  BindingPattern,
  Class,
  Expression,
  Function as FunctionNode,
  Span,
  Statement,
} from "oxc-parser";
import type { ParsedSourceFile, TypeScriptDeclaration } from "../parse/source-types.js";

export type ImportedName =
  | { kind: "default" }
  | { kind: "namespace" }
  | { kind: "named"; name: string };

export interface ImportBinding {
  localName: string;
  imported: ImportedName;
  specifier: string;
  isTypeOnly: boolean;
  span: Span;
}

export interface ExportedLocal {
  kind: "local";
  exportedName: string;
  localName: string;
}

export interface ExportedExpression {
  kind: "expression";
  exportedName: string;
  expression: Expression;
}

export interface ReExport {
  kind: "re-export";
  exportedName: string;
  imported: ImportedName;
  specifier: string;
}

export interface ReExportAll {
  kind: "re-export-all";
  specifier: string;
}

export type ExportEntry = ExportedLocal | ExportedExpression | ReExport | ReExportAll;

export type TopLevelBinding =
  | {
      kind: "variable";
      name: string;
      init: Expression | null;
      declarationKind: "const" | "let" | "var" | "using" | "await using";
      span: Span;
    }
  | { kind: "function"; name: string; node: FunctionNode; span: Span }
  | { kind: "class"; name: string; node: Class; span: Span }
  | { kind: "typescript"; name: string; node: TypeScriptDeclaration; span: Span }
  | { kind: "import"; name: string; binding: ImportBinding; span: Span }
  | {
      kind: "destructured";
      name: string;
      pattern: BindingPattern;
      init: Expression | null;
      span: Span;
    };

export interface ModuleRecord {
  filePath: string;
  file: ParsedSourceFile;
  /** Leading string directives such as `"use client"` or `"use strict"`. */
  directives: string[];
  imports: ImportBinding[];
  exports: ExportEntry[];
  bindings: Map<string, TopLevelBinding>;
  /** Specifiers of static `import`/`export ... from` declarations, in source order. */
  dependencies: string[];
  /** Top-level statements that run when the module is evaluated (`X.displayName = ...`, `registry.set(...)`, `const x = create()`). */
  sideEffectStatements: Statement[];
  /** Bindings whose initializer hands another top-level binding to a call (`const re = pathToRegexp(path, keys)`), which may fill it in: they are initialized with the module. */
  outParameterBindings: string[];
  /** Exports were collected from `exports.x = ` / `module.exports` assignments rather than ESM syntax. */
  isCommonJs: boolean;
  /** The `value` of `module.exports = value`, whose runtime members are the exports a bundler imports. */
  moduleExports: Expression | null;
  /** Names assigned onto that value afterwards (`module.exports.compile = compile`). */
  moduleExportsMembers: string[];
}

export type ModuleResolution =
  | { kind: "internal"; filePath: string }
  | ExternalModuleResolution
  | BuiltinModuleResolution
  | { kind: "unresolved"; specifier: string; error: string };

export interface ExternalModuleResolution {
  kind: "external";
  packageName: string;
  filePath: string | null;
  /** The specifier by which the module is known (`next/script` for an import of `next/script.js`). */
  specifier: string;
}

export interface BuiltinModuleResolution {
  kind: "builtin";
  specifier: string;
}

export interface UnresolvedSymbol {
  kind: "unresolved";
  reason: string;
  isAmbiguous?: true;
  isUncertain?: true;
}

/**
 * Under RSC, what server code imports from a `"use client"` module is a
 * reference to the export, rendered on the client, wherever the value itself
 * was defined.
 */
export type ResolvedSymbol =
  | { kind: "binding"; module: ModuleRecord; binding: TopLevelBinding; isClientReference: boolean }
  | {
      kind: "expression";
      module: ModuleRecord;
      exportedName: string;
      expression: Expression;
      isClientReference: boolean;
    }
  | { kind: "namespace"; module: ModuleRecord; externalSpecifier?: string }
  /** A member of a CommonJS module's evaluated `module.exports`, read as bundlers do. */
  | {
      kind: "module-exports";
      module: ModuleRecord;
      exportedName: string;
      isClientReference: boolean;
    }
  | {
      kind: "external";
      packageName: string;
      imported: ImportedName;
      specifier: string;
      /** The installed file the import resolves to; null when the package is not installed. */
      filePath: string | null;
    }
  | { kind: "stylesheet"; filePath: string; imported: ImportedName }
  | {
      kind: "asset";
      filePath: string;
      /** The import specifier as written, whose query (`?url`, `?inline`, ...) selects how the bundler serves the file. */
      specifier: string;
      imported: ImportedName;
    }
  | UnresolvedSymbol;
