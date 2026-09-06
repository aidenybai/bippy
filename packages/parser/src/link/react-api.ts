import { DEFAULT_EXPORT_NAME, NAMESPACE_IMPORT_NAME } from "../module/types.js";
import type { LinkedSymbol } from "./linker.js";

export type ReactApiSource = "react" | "react-dom" | "react/jsx-runtime";

export interface ReactApiReference {
  api: string;
  source: ReactApiSource;
}

const getApiSource = (specifier: string): ReactApiSource | null => {
  if (specifier === "react" || specifier === "react/compiler-runtime") return "react";
  if (specifier === "react/jsx-runtime" || specifier === "react/jsx-dev-runtime") {
    return "react/jsx-runtime";
  }
  if (specifier === "react-dom" || specifier.startsWith("react-dom/")) return "react-dom";
  return null;
};

/**
 * Identifies references into React's public surface, whichever import style
 * produced them: `React.memo`, `memo`, `_react.default.memo` or the automatic
 * runtime's `_jsxRuntime.jsx`.
 */
export const getReactApiReference = (symbol: LinkedSymbol): ReactApiReference | null => {
  if (symbol.kind !== "external") return null;
  const source = getApiSource(symbol.specifier);
  if (!source) return null;
  let memberPath = symbol.memberPath;
  let api: string | null = null;
  if (symbol.importedName === DEFAULT_EXPORT_NAME || symbol.importedName === NAMESPACE_IMPORT_NAME) {
    if (memberPath[0] === DEFAULT_EXPORT_NAME) memberPath = memberPath.slice(1);
    api = memberPath[0] ?? null;
    memberPath = memberPath.slice(1);
  } else {
    api = symbol.importedName;
  }
  if (api === null || memberPath.length > 0) return null;
  return { api, source };
};
