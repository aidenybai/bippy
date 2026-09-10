// When a pre-bundled chunk holds two same-named declarations (react-router-dom
// and @remix-run/react both export `ScrollRestoration`), esbuild renames the
// later one `ScrollRestoration2` and rollup `ScrollRestoration$1`.
const BUNDLER_DEDUPE_SUFFIX = /^(?:\$\d+|\d+)$/;

export const isBundlerDedupedName = (name: string, runtimeName: string): boolean =>
  runtimeName.startsWith(name) && BUNDLER_DEDUPE_SUFFIX.test(runtimeName.slice(name.length));

// esbuild in bundle mode (the Remix classic compiler) hoists an anonymous
// `export default function () {}` to `<basename>_default`; unbundled ESM keeps
// the spec name `default`.
const BUNDLED_DEFAULT_EXPORT_NAME = /^[A-Za-z_$][\w$]*_default$/;

export const isBundledDefaultExportName = (name: string, runtimeName: string): boolean =>
  name === "default" && BUNDLED_DEFAULT_EXPORT_NAME.test(runtimeName);

// React Compiler's `outlineFunctions` hoists a context-free anonymous function
// out of a component to module scope under Babel's `generateUidIdentifier()`
// name (`_temp`, `_temp2`, …), discarding the name the source position gave it.
const REACT_COMPILER_OUTLINED_NAME = /^_temp\d*$/;

export const isReactCompilerOutlinedName = (runtimeName: string): boolean =>
  REACT_COMPILER_OUTLINED_NAME.test(runtimeName);
