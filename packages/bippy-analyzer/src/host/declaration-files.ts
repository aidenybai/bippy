import { readFileSync } from "node:fs";
import path from "node:path";
import type { Program } from "oxc-parser";
import { parseSync } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";
import { DeclarationModuleError } from "../errors.js";

export interface DeclarationFile {
  filePath: string;
  /** Stable id for a module file: its package path (`undici-types/fetch`) rather than an absolute path. */
  moduleId: string;
  program: Program;
  /** `/// <reference lib|path>` targets, already made absolute. */
  references: string[];
}

const REFERENCE_DIRECTIVE = /^\/\/\/\s*<reference\s+(lib|path)="([^"]+)"/gm;

const NODE_MODULES_SEGMENT = "/node_modules/";

const DECLARATION_EXTENSIONS = /\.d\.[cm]?ts$|\.[cm]?ts$/;

const getModuleId = (filePath: string, rootDirectory: string): string => {
  const posixPath = filePath.replaceAll("\\", "/");
  const packageIndex = posixPath.lastIndexOf(NODE_MODULES_SEGMENT);
  const relative =
    packageIndex === -1
      ? path.relative(rootDirectory, filePath).replaceAll("\\", "/")
      : posixPath.slice(packageIndex + NODE_MODULES_SEGMENT.length);
  return relative.replace(DECLARATION_EXTENSIONS, "");
};

const parseDeclarationSource = (fileName: string, sourceText: string): Program =>
  parseSync(fileName, sourceText, { lang: "ts", sourceType: "module", astType: "ts" }).program;

/**
 * Reads `.d.ts` files the way the compiler locates them: `/// <reference lib>`
 * from TypeScript's `lib` directory, `/// <reference path>` relative to the
 * file, and import specifiers through TypeScript's `bundler` module resolution
 * (oxc-resolver's declaration mode).
 */
export class DeclarationFileLoader {
  private readonly resolver = new ResolverFactory({});

  constructor(
    private readonly libDirectory: string,
    private readonly rootDirectory: string,
  ) {}

  load(filePath: string): DeclarationFile {
    const resolved = path.resolve(filePath);
    return this.fromSource(resolved, readFileSync(resolved, "utf8"));
  }

  fromSource(filePath: string, sourceText: string): DeclarationFile {
    const references = [...sourceText.matchAll(REFERENCE_DIRECTIVE)].map(([, directive, target]) =>
      directive === "lib"
        ? path.join(this.libDirectory, `lib.${target}.d.ts`)
        : path.resolve(path.dirname(filePath), target),
    );
    return {
      filePath,
      moduleId: getModuleId(filePath, this.rootDirectory),
      program: parseDeclarationSource(filePath, sourceText),
      references,
    };
  }

  resolveSpecifier(specifier: string, fromFile: string): string {
    const result = this.resolver.resolveDtsSync(fromFile, specifier);
    if (!result.path) {
      throw new DeclarationModuleError(specifier, fromFile, result.error ?? "not found");
    }
    return result.path;
  }
}
