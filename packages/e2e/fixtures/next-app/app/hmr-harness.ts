import { getDisplayName, isFiber } from "bippy";
import { instrumentReactRefresh } from "bippy/react-refresh";
import { getSource } from "bippy/source";

interface BippyRefreshUpdateRecord {
  // fibers are cyclic and cannot cross the page.evaluate serialization
  // boundary, so the harness records their names and an isFiber validity
  // check instead of the fiber objects the api hands back
  areUpdatedFibersValid: boolean;
  filePaths: string[];
  staleFiberNames: (string | null)[];
  staleNames: (string | null)[];
  updatedFiberNames: (string | null)[];
  updatedNames: (string | null)[];
  updatedSourceFileNames: (string | null)[];
}

interface BippyHmrHarness {
  refreshUpdates: BippyRefreshUpdateRecord[];
  hasRefreshListener: boolean;
  // second listener wiring lets the dispose spec verify that listeners
  // compose and that dispose() only unwinds its own patches
  secondListenerUpdatedNames: string[];
  installSecondListener: () => boolean;
  disposeSecondListener: () => void;
}

declare global {
  interface Window {
    __BIPPY_HMR__: BippyHmrHarness;
  }
}

export const installHmrHarness = () => {
  if (typeof window === "undefined" || window.__BIPPY_HMR__) return;

  let unsubscribeSecondListener: (() => void) | null = null;
  const harness: BippyHmrHarness = {
    refreshUpdates: [],
    hasRefreshListener: false,
    secondListenerUpdatedNames: [],
    installSecondListener: () => {
      unsubscribeSecondListener ??= instrumentReactRefresh({
        onRefresh: (update) => {
          for (const componentType of update.updatedComponents) {
            harness.secondListenerUpdatedNames.push(getDisplayName(componentType) ?? "unknown");
          }
        },
      });
      return true;
    },
    disposeSecondListener: () => {
      unsubscribeSecondListener?.();
      unsubscribeSecondListener = null;
    },
  };
  window.__BIPPY_HMR__ = harness;

  instrumentReactRefresh({
    onRefresh: async (update) => {
      const record: BippyRefreshUpdateRecord = {
        areUpdatedFibersValid: update.updatedFibers.every((fiber) => isFiber(fiber)),
        filePaths: update.filePaths,
        staleFiberNames: update.staleFibers.map((fiber) => getDisplayName(fiber.type)),
        staleNames: update.staleComponents.map((componentType) => getDisplayName(componentType)),
        updatedFiberNames: update.updatedFibers.map((fiber) => getDisplayName(fiber.type)),
        updatedNames: update.updatedComponents.map((componentType) =>
          getDisplayName(componentType),
        ),
        updatedSourceFileNames: [],
      };
      harness.refreshUpdates.push(record);
      const updatedSources = await Promise.all(
        update.updatedFibers.map((fiber) => getSource(fiber)),
      );
      record.updatedSourceFileNames = updatedSources.map((source) => source?.fileName ?? null);
    },
  });
  harness.hasRefreshListener = true;
};
