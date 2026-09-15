import { instrument, type FiberRoot } from "bippy";
import { act, type ReactNode } from "react";
import { createRoot, type RootOptions } from "react-dom/client";
import { afterEach } from "vite-plus/test";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export const createRenderHarness = (options?: RootOptions) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let committedRoot: FiberRoot | null = null;
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if ("containerInfo" in root && root.containerInfo === container) committedRoot = root;
    },
  });
  const root = createRoot(container, options);
  cleanups.push(async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      unsubscribe();
      container.remove();
    }
  });
  return {
    container,
    render: async (children: ReactNode) => {
      await act(async () => root.render(children));
    },
    getRoot: (): FiberRoot => {
      if (!committedRoot) throw new Error("Renderer did not commit to Bippy's hook");
      return committedRoot;
    },
  };
};
