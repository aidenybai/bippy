import type { ReactNode } from "react";
import { createCommitRecorder, getRootContainer } from "../harness/commit-recorder.js";
import type { RuntimeSnapshot } from "../harness/snapshot.js";
import type { ReactRuntime } from "./react-runtime.js";

const SETTLE_ROUNDS = 8;

const noop = (): void => {};

export interface MountResult {
  snapshot: RuntimeSnapshot;
  /** Errors React surfaced while rendering: uncaught ones unmount the tree, caught ones reached a boundary. */
  uncaughtErrors: unknown[];
  caughtErrors: unknown[];
}

/**
 * Mounts a React element in a fresh root, lets effects, state updates and lazy
 * resolutions settle under `act`, and returns the committed fiber tree as
 * bippy observed it.
 */
export const mountNode = async (runtime: ReactRuntime, node: ReactNode): Promise<MountResult> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  const uncaughtErrors: unknown[] = [];
  const caughtErrors: unknown[] = [];
  const root = runtime.domClient.createRoot(container, {
    onUncaughtError: (error) => uncaughtErrors.push(error),
    onCaughtError: (error) => caughtErrors.push(error),
    onRecoverableError: () => {},
  });
  const { error: consoleError, warn: consoleWarn } = console;
  // HACK: React DOM's dev warnings (missing keys on materialized lists, DOM nesting
  // inside the harness container) describe the materialized tree, not the app;
  // real render failures are reported through the root callbacks instead.
  console.error = noop;
  console.warn = noop;
  try {
    try {
      await runtime.act(async () => root.render(node));
      for (let round = 0; round < SETTLE_ROUNDS; round++) {
        await runtime.act(async () => {
          await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
        });
      }
    } catch (error) {
      uncaughtErrors.push(error);
    }
    return { snapshot: recorder.snapshot(), uncaughtErrors, caughtErrors };
  } finally {
    await runtime.act(async () => root.unmount());
    console.error = consoleError;
    console.warn = consoleWarn;
    recorder.dispose();
    container.remove();
  }
};
