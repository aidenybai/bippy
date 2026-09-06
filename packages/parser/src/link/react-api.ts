import { join } from "node:path";
import { DEFAULT_EXPORT_NAME, NAMESPACE_IMPORT_NAME } from "../module/types.js";
import type { Project } from "../project/project.js";

export type ReactApiSource = "react" | "react-dom" | "react/jsx-runtime";

/**
 * The `$$typeof` brand of an element (`shared/ReactSymbols.js`), which React
 * 19 renamed so that older `react-is` builds stop recognising its elements.
 * Read from the React the project resolves; a project without one is taken
 * to be current.
 */
export const getReactElementType = (project: Project): symbol => {
  const resolved = project.resolveSpecifier(
    join(project.rootDirectory, "index.js"),
    "react/package.json",
  );
  const manifest = resolved ? project.readSource(resolved.path) : null;
  const major = Number(manifest === null ? undefined : /"version":\s*"(\d+)/.exec(manifest)?.[1]);
  return major < 19 ? Symbol.for("react.element") : Symbol.for("react.transitional.element");
};

export interface ReactApiReference {
  api: string;
  source: ReactApiSource;
}

/** The classes React offers to extend. */
export const REACT_BASE_CLASSES = new Set(["Component", "PureComponent"]);

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
