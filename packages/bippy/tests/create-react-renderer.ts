import type { ReactRenderer } from "../src/react-internals/index.js";

export const createReactRenderer = (overrides: Record<string, unknown> = {}): ReactRenderer => {
  const renderer: ReactRenderer = {
    bundleType: 1,
    rendererPackageName: "test-renderer",
    version: "19.0.0",
  };

  return Object.assign(renderer, overrides);
};
