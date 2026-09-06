import assert from "node:assert/strict";
import type { ReactDevToolsTarget, ReactRenderer, Unsubscribe } from "bippy";
import {
  benchmarkCase,
  createBenchmarkSuite,
  equals,
  type BenchmarkCase,
  type BenchmarkContext,
} from "./harness.js";
import { createFiber, createTree } from "./fixtures.js";

const createRenderer = (): ReactRenderer => ({
  version: "19.2.4",
  rendererPackageName: "benchmark",
  bundleType: 1,
});
const hookInstallers: Array<"installRDTHook" | "getRDTHook"> = ["installRDTHook", "getRDTHook"];
const events: Array<"commit" | "unmount" | "post-commit" | "schedule"> = [
  "commit",
  "unmount",
  "post-commit",
  "schedule",
];

export const createInstrumentationBenchmarks = ({ Bippy }: BenchmarkContext): BenchmarkCase[] => {
  const target: ReactDevToolsTarget = {};
  const hook = Bippy.getRDTHook(undefined, target);
  const { cases, add } = createBenchmarkSuite("bippy");
  add("getRDTHook", "warm", () => Bippy.getRDTHook(undefined, target), equals(hook));
  add(
    "patchRDTHook",
    "already-patched",
    () => Bippy.patchRDTHook(undefined, target),
    () => assert.equal(target.__REACT_DEVTOOLS_GLOBAL_HOOK__, hook),
  );
  add("hasRDTHook", "present", () => Bippy.hasRDTHook(target), equals(true));
  add("isRealReactDevtools", "bippy-hook", () => Bippy.isRealReactDevtools(hook), equals(false));
  add("isReactRefresh", "bippy-hook", () => Bippy.isReactRefresh(hook), equals(false));
  add(
    "isInstrumentationActive",
    "inactive",
    () => Bippy.isInstrumentationActive(target),
    equals(false),
  );
  const root = createTree(0, "wide").root;
  add("isFiberRootUnmounted", "mounted", () => Bippy.isFiberRootUnmounted(root), equals(false));
  add("instrument", "subscribe-dispose", () => Bippy.instrument({ target })(), equals(undefined));
  add(
    "onRendererInject",
    "subscribe-dispose",
    () => Bippy.onRendererInject(() => {}, target)(),
    equals(undefined),
  );
  for (const name of hookInstallers) {
    let targets: ReactDevToolsTarget[] = [];
    cases.push(
      benchmarkCase(
        `${name}/cold-target`,
        [`bippy#${name}`],
        (iteration) => Bippy[name](undefined, targets[iteration]),
        (value) => {
          assert.equal(typeof value, "object");
          assert.ok(value && Reflect.get(value, "supportsFiber"));
        },
        {
          prepare: (iterations) => {
            targets = Array.from({ length: iterations }, () => ({}));
          },
          maxIterations: 1024,
        },
      ),
    );
  }
  for (const count of [0, 1, 10, 100, 1000]) {
    for (const event of events) {
      const eventTarget: ReactDevToolsTarget = {};
      const eventHook = Bippy.getRDTHook(undefined, eventTarget);
      const eventRoot = createTree(0, "wide").root;
      const fiber = createFiber({ return: eventRoot.current });
      const subscriptions: Unsubscribe[] = [];
      let callCount = 0;
      cases.push(
        benchmarkCase(
          `instrument/${event}-${count}-listeners`,
          ["bippy#instrument"],
          () => {
            callCount = 0;
            if (event === "commit") eventHook.onCommitFiberRoot(1, eventRoot, undefined);
            else if (event === "unmount") eventHook.onCommitFiberUnmount(1, fiber);
            else if (event === "post-commit") eventHook.onPostCommitFiberRoot(1, eventRoot);
            else eventHook.onScheduleFiberRoot?.(1, eventRoot, null);
            return callCount;
          },
          equals(count),
          {
            prepare: () => {
              if (subscriptions.length) return;
              subscriptions.push(Bippy.instrument({ target: eventTarget }));
              for (let index = 0; index < count; index++) {
                const listener = () => {
                  callCount++;
                };
                subscriptions.push(
                  Bippy.instrument({
                    target: eventTarget,
                    onCommitFiberRoot: listener,
                    onCommitFiberUnmount: listener,
                    onPostCommitFiberRoot: listener,
                    onScheduleFiberRoot: listener,
                  }),
                );
              }
            },
            cleanup: () => {
              subscriptions.forEach((unsubscribe) => unsubscribe());
              Bippy._fiberRoots.delete(eventRoot);
            },
          },
        ),
      );
    }
  }
  const injectionTarget: ReactDevToolsTarget = {};
  const injectionHook = Bippy.getRDTHook(undefined, injectionTarget);
  let renderers: ReactRenderer[] = [];
  let unsubscribeInjection: Unsubscribe | undefined;
  let injections = 0;
  const clearRenderers = () => {
    renderers.forEach((renderer) => Bippy._renderers.delete(renderer));
    injectionHook.renderers.clear();
  };
  cases.push(
    benchmarkCase(
      "onRendererInject/dispatch-new-renderer",
      ["bippy#onRendererInject"],
      (iteration) => {
        injections = 0;
        injectionHook.inject(renderers[iteration]);
        return injections;
      },
      equals(1),
      {
        prepare: (iterations) => {
          unsubscribeInjection ??= Bippy.onRendererInject(() => {
            injections++;
          }, injectionTarget);
          clearRenderers();
          renderers = Array.from({ length: iterations }, createRenderer);
        },
        cleanup: () => {
          unsubscribeInjection?.();
          clearRenderers();
        },
        maxIterations: 128,
      },
    ),
  );
  const throwingTarget: ReactDevToolsTarget = {};
  const throwingHook = Bippy.getRDTHook(undefined, throwingTarget);
  const originalError = console.error;
  let unsubscribeThrowing: Unsubscribe | undefined;
  let reportCount = 0;
  const listenerError = new Error("benchmark listener error");
  cases.push(
    benchmarkCase(
      "instrument/throwing-listener-stubbed-reporter",
      ["bippy#instrument"],
      () => {
        reportCount = 0;
        throwingHook.onCommitFiberRoot(1, root, undefined);
        return reportCount;
      },
      equals(1),
      {
        prepare: () => {
          console.error = () => {
            reportCount++;
          };
          unsubscribeThrowing ??= Bippy.instrument({
            target: throwingTarget,
            onCommitFiberRoot: () => {
              throw listenerError;
            },
          });
        },
        cleanup: () => {
          console.error = originalError;
          unsubscribeThrowing?.();
          Bippy._fiberRoots.delete(root);
        },
      },
    ),
  );
  return cases;
};
