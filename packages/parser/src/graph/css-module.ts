import { readFileSync } from "node:fs";
import {
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import type { ImportedName, StaticValue } from "../types.js";

const CSS_MODULE_PATH = /\.module\.(css|pcss|postcss|scss|sass|less|styl|stylus)$/;
/** Vite's `CSS_LANGS_RE`: files its own css plugin serves. */
const STYLESHEET_PATH = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/gm;
const VARIABLE_DECLARATION = /^\s*[$@]([\w-]+)\s*:\s*([^;{}]+?)\s*(?:!default\s*)?;/gm;
const EXPORT_BLOCK = /:export\s*\{((?:#\{[^}]*\}|[^}])*)\}/g;
const EXPORT_ENTRY = /([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g;
const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

export interface CssModuleExports {
  classNames: string[];
  /** `:export { name: value }` entries; null when the value is computed by the preprocessor. */
  values: Map<string, string | null>;
}

export const isCssModulePath = (filePath: string): boolean => CSS_MODULE_PATH.test(filePath);

export const isStylesheetPath = (filePath: string): boolean => STYLESHEET_PATH.test(filePath);

const resolveVariable = (
  value: string,
  variables: Map<string, string>,
  visited: Set<string>,
): string | null => {
  const reference = /^[$@]([\w-]+)$/.exec(value);
  if (!reference) return /#\{|\(/.test(value) ? null : value;
  const name = reference[1];
  const declared = variables.get(name);
  if (declared === undefined || visited.has(name)) return null;
  visited.add(name);
  return resolveVariable(declared, variables, visited);
};

const collectClassNames = (stylesheet: string): string[] => {
  const classNames = new Set<string>();
  for (const block of stylesheet.split("{").slice(0, -1)) {
    const selector = block.slice(Math.max(block.lastIndexOf(";"), block.lastIndexOf("}")) + 1);
    for (const match of selector.matchAll(CLASS_SELECTOR)) classNames.add(match[1]);
  }
  return [...classNames];
};

export const parseCssModule = (sourceText: string): CssModuleExports => {
  const stylesheet = sourceText.replace(COMMENTS, "$1");
  const variables = new Map<string, string>();
  for (const match of stylesheet.matchAll(VARIABLE_DECLARATION)) {
    variables.set(match[1], match[2]);
  }
  const values = new Map<string, string | null>();
  for (const block of stylesheet.matchAll(EXPORT_BLOCK)) {
    for (const entry of block[1].matchAll(EXPORT_ENTRY)) {
      values.set(entry[1], resolveVariable(entry[2], variables, new Set()));
    }
  }
  return { classNames: collectClassNames(stylesheet), values };
};

/** What the bundler's CSS-modules transform exports from a stylesheet: hashed class names plus `:export` values. */
export const getCssModuleValue = (filePath: string, imported: ImportedName): StaticValue => {
  const { classNames, values } = parseCssModule(readFileSync(filePath, "utf8"));
  const record: Record<string, StaticValue> = {};
  for (const className of classNames) {
    record[className] = unknownPrimitiveValue(
      "string",
      `class name the bundler hashed for .${className}`,
    );
  }
  for (const [name, value] of values) {
    record[name] =
      value === null
        ? unknownPrimitiveValue("string", `stylesheet value "${name}" computed by the preprocessor`)
        : primitiveValue(value);
  }
  if (imported.kind === "named") return record[imported.name] ?? UNDEFINED_VALUE;
  return objectFromRecord(record);
};
