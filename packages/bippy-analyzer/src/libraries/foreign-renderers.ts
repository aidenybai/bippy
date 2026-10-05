import type { LibraryValueProvider } from "../types.js";

// Libraries that render with their own runtime (Solid, a canvas 2D context) into
// a node React hands them: nothing they do reaches the fiber tree, so their
// exports stay opaque externals instead of interpreting a foreign renderer.

export const FOREIGN_RENDERER_PACKAGES = [
  "@tanstack/devtools",
  "@tanstack/devtools-ui",
  "@tanstack/query-devtools",
  "chart.js",
];

export const foreignRendererValue: LibraryValueProvider = () => null;
