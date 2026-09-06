import { DEFAULT_EXPORT_NAME, NAMESPACE_IMPORT_NAME } from "../module/types.js";

export type ReactApiSource = "react" | "react-dom" | "react/jsx-runtime";

export interface ReactApiReference {
  api: string;
  source: ReactApiSource;
}

/** The shape shared by external linker symbols and external static values. */
export interface ExternalReference {
  specifier: string;
  importedName: string;
  memberPath: string[];
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
 * runtime's `_jsxRuntime.jsx`. Returns `null` for deeper paths such as
 * `React.Children.map`; callers handle those namespaces themselves.
 */
export const getReactApiReference = (reference: ExternalReference): ReactApiReference | null => {
  const source = getApiSource(reference.specifier);
  if (!source) return null;
  let memberPath = reference.memberPath;
  let api: string | null;
  if (
    reference.importedName === DEFAULT_EXPORT_NAME ||
    reference.importedName === NAMESPACE_IMPORT_NAME
  ) {
    if (memberPath[0] === DEFAULT_EXPORT_NAME) memberPath = memberPath.slice(1);
    api = memberPath[0] ?? null;
    memberPath = memberPath.slice(1);
  } else {
    api = reference.importedName;
  }
  if (api === null || memberPath.length > 0) return null;
  return { api, source };
};
