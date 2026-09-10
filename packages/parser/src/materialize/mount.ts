import type { ReactNode } from "react";
import type { TimerQueue } from "../evaluate/timers.js";
import { createCommitRecorder, getRootContainer } from "../harness/commit-recorder.js";
import type { RuntimeSnapshot } from "../harness/snapshot.js";
import type { ReactRuntime } from "./react-runtime.js";
import type { RendererHost } from "./renderer-host.js";

const SETTLE_ROUNDS = 8;
const MAX_TIMER_ROUNDS = 512;

const noop = (): void => {};

export interface MountResult {
  snapshot: RuntimeSnapshot;
  /** Every tree React committed while settling, in order; the last one is `snapshot`. */
  commits: RuntimeSnapshot[];
  /** Errors React surfaced while rendering: uncaught ones unmount the tree, caught ones reached a boundary. */
  uncaughtErrors: unknown[];
  caughtErrors: unknown[];
}

/**
 * Mounts React elements each in a fresh root (one per element, in order), lets
 * effects, state updates, lazy resolutions and the static timer queue (one
 * task per settle round) settle under `act`, and returns the committed fiber
 * trees as bippy observed them. Rounds continue while tasks or the effects
 * they trigger keep queueing more, up to a bound; `onCommit` runs after each
 * React commit.
 */
export const mountNodes = async (
  runtime: ReactRuntime,
  host: RendererHost<Element>,
  nodes: ReactNode[],
  timers: TimerQueue,
  onCommit: () => void,
): Promise<MountResult> => {
  const containers = nodes.map(() => host.createContainer());
  const detachContainers = containers.map((container) => host.attachContainer(container));
  const recorder = createCommitRecorder({
    rootFilter: (root) => containers.some((container) => container === getRootContainer(root)),
    recordCommits: true,
    onCommit,
  });
  const uncaughtErrors: unknown[] = [];
  const caughtErrors: unknown[] = [];
  const roots = containers.map((container) =>
    runtime.createRoot(container, {
      onUncaughtError: (error) => uncaughtErrors.push(error),
      onCaughtError: (error) => caughtErrors.push(error),
    }),
  );
  const { error: consoleError, warn: consoleWarn } = console;
  // HACK: React DOM's dev warnings (missing keys on materialized lists, DOM nesting
  // inside the harness container) describe the materialized tree, not the app;
  // real render failures are reported through the root callbacks instead.
  console.error = noop;
  console.warn = noop;
  try {
    try {
      for (const [index, root] of roots.entries()) {
        await runtime.act(async () => root.render(nodes[index]));
      }
      for (let round = 0; round < MAX_TIMER_ROUNDS; round++) {
        await runtime.act(async () => {
          timers.runNextTask();
          await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0));
        });
        if (!timers.hasTasks() && round >= SETTLE_ROUNDS - 1) break;
      }
    } catch (error) {
      uncaughtErrors.push(error);
    }
    return {
      snapshot: recorder.snapshot(),
      commits: recorder.commits(),
      uncaughtErrors,
      caughtErrors,
    };
  } finally {
    for (const root of roots) await runtime.act(async () => root.unmount());
    console.error = consoleError;
    console.warn = consoleWarn;
    recorder.dispose();
    for (const detachContainer of detachContainers) detachContainer();
  }
};
