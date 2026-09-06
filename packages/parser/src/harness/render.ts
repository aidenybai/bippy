import { type FiberRoot, instrument } from "bippy";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { FiberSnapshot } from "../snapshot/types.js";
import { snapshotRuntimeFiber } from "./runtime-snapshot.js";

export interface RuntimeHarness {
  container: HTMLElement;
  /** Renders and returns the committed tree, resolving effects and suspended lazies first. */
  render: (children: ReactNode) => Promise<FiberSnapshot>;
  unmount: () => Promise<void>;
}

/** How long to keep flushing after a commit so lazies and suspended data can settle. */
const SETTLE_ROUNDS = 8;

/**
 * Renders into a detached DOM container with Bippy observing commits. The
 * hook must already be installed (`bippy/install-hook-only`) before React
 * DOM is imported, which the test setup does.
 */
export const createRuntimeHarness = (): RuntimeHarness => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let committedRoot: FiberRoot | null = null;
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRoot = root;
    },
  });
  const root = createRoot(container);
  return {
    container,
    render: async (children) => {
      await act(async () => root.render(children));
      for (let round = 0; round < SETTLE_ROUNDS; round++) {
        await act(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
      }
      if (!committedRoot) throw new Error("React did not commit through Bippy's hook");
      return snapshotRuntimeFiber(committedRoot.current);
    },
    unmount: async () => {
      try {
        await act(async () => root.unmount());
      } finally {
        unsubscribe();
        container.remove();
      }
    },
  };
};

export const renderRuntimeSnapshot = async (children: ReactNode): Promise<FiberSnapshot> => {
  const harness = createRuntimeHarness();
  try {
    return await harness.render(children);
  } finally {
    await harness.unmount();
  }
};
