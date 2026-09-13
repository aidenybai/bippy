import { isModuleRecord, type ModuleGraph } from "../graph/module-graph.js";
import type { ModuleRecord } from "../types.js";

// `@remix-run/dev`'s Vite plugin (`vite/styles.ts`) inlines, as critical CSS,
// every side-effect stylesheet reachable from the client entry and the matched
// route modules; `criticalCss` is undefined when that set is empty.
const CSS_FILE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const CSS_URL_PARAMS_WITHOUT_SIDE_EFFECTS = ["url", "inline", "inline-css", "raw"];

const isCssUrlWithoutSideEffects = (specifier: string): boolean => {
  const query = specifier.split("?")[1];
  if (!query) return false;
  const params = new URLSearchParams(query);
  return CSS_URL_PARAMS_WITHOUT_SIDE_EFFECTS.some(
    (param) => params.get(param) === "" && !new RegExp(`[?&]${param}=`).test(specifier),
  );
};

const isSideEffectStylesheet = (specifier: string): boolean =>
  CSS_FILE.test(specifier) && !isCssUrlWithoutSideEffects(specifier);

/** Whether the Vite module graph under `roots` imports a stylesheet for its side effects. */
export const importsCriticalCss = (graph: ModuleGraph, roots: ModuleRecord[]): boolean => {
  const visited = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const module = pending.pop();
    if (!module || visited.has(module.filePath)) continue;
    visited.add(module.filePath);
    for (const specifier of module.dependencies) {
      if (isSideEffectStylesheet(specifier)) return true;
      const resolved = graph.resolveImportedModule(specifier, module);
      if (isModuleRecord(resolved)) pending.push(resolved);
    }
  }
  return false;
};
