import type { Comment } from "oxc-parser";
import type { JsxPragma } from "../types.js";

// `@babel/plugin-transform-react-jsx`'s annotation patterns: any comment in the file, last one wins.
const RUNTIME_PATTERN = /^\s*\*?\s*@jsxRuntime\s+(\S+)\s*$/m;
const FACTORY_PATTERN = /^\s*\*?\s*@jsx\s+(\S+)\s*$/m;
const FRAGMENT_PATTERN = /^\s*\*?\s*@jsxFrag\s+(\S+)\s*$/m;
const IMPORT_SOURCE_PATTERN = /^\s*\*?\s*@jsxImportSource\s+(\S+)\s*$/m;

const matchAnnotation = (pattern: RegExp, comment: string): string | null =>
  pattern.exec(comment)?.[1] ?? null;

export const readJsxPragma = (comments: readonly Comment[]): JsxPragma | null => {
  const pragma: JsxPragma = { runtime: null, factory: null, fragment: null, importSource: null };
  let hasAnnotation = false;
  for (const comment of comments) {
    if (!comment.value.includes("@jsx")) continue;
    const runtime = matchAnnotation(RUNTIME_PATTERN, comment.value);
    if (runtime === "classic" || runtime === "automatic") pragma.runtime = runtime;
    pragma.factory = matchAnnotation(FACTORY_PATTERN, comment.value) ?? pragma.factory;
    pragma.fragment = matchAnnotation(FRAGMENT_PATTERN, comment.value) ?? pragma.fragment;
    pragma.importSource =
      matchAnnotation(IMPORT_SOURCE_PATTERN, comment.value) ?? pragma.importSource;
    hasAnnotation ||=
      runtime !== null ||
      pragma.factory !== null ||
      pragma.fragment !== null ||
      pragma.importSource !== null;
  }
  return hasAnnotation ? pragma : null;
};
