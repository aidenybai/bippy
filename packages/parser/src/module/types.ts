import type {
  Class,
  Expression,
  Function as FunctionNode,
  Program,
  Span,
  TSEnumDeclaration,
  VariableDeclarator,
} from "@oxc-project/types";
import type { EcmaScriptModule, OxcError } from "oxc-parser";
import type { LineIndex } from "./location.js";

export const DEFAULT_EXPORT_NAME = "default";
export const NAMESPACE_IMPORT_NAME = "*";

export interface ImportBinding {
  kind: "import";
  localName: string;
  moduleRequest: string;
  /** `default`, `*` for namespace imports, otherwise the exported name. */
  importedName: string;
  isTypeOnly: boolean;
  span: Span;
}

export type DeclarationNode = FunctionNode | Class | VariableDeclarator | TSEnumDeclaration;

export interface DeclarationBinding {
  kind: "declaration";
  localName: string;
  node: DeclarationNode;
  span: Span;
}

export type Binding = ImportBinding | DeclarationBinding;

export interface LocalExport {
  kind: "local";
  exportedName: string;
  localName: string;
  span: Span;
}

export interface ValueExport {
  kind: "value";
  exportedName: string;
  node: Expression | FunctionNode | Class;
  span: Span;
}

export interface ReExport {
  kind: "reexport";
  exportedName: string;
  moduleRequest: string;
  /** `*` for `export * as ns from` */
  importedName: string;
  span: Span;
}

export interface StarExport {
  kind: "star";
  moduleRequest: string;
  span: Span;
}

export type NamedExport = LocalExport | ValueExport | ReExport;

export interface ModuleExports {
  named: Map<string, NamedExport>;
  stars: StarExport[];
  /** Whether exports were declared through `module.exports` / `exports.*`. */
  isCommonJs: boolean;
}

export type ModuleEnvironment = "client" | "server" | "shared";

export interface ParsedModule {
  filePath: string;
  sourceText: string;
  program: Program;
  esm: EcmaScriptModule;
  errors: OxcError[];
  directives: string[];
  environment: ModuleEnvironment;
  lineIndex: LineIndex;
  bindings: Map<string, Binding>;
  exports: ModuleExports;
}
