import { getDisplayName, isFiber } from "bippy";
import { onReactRefresh } from "bippy/react-refresh";

interface BippyRefreshUpdateRecord {
  // fibers are cyclic and cannot cross the page.evaluate serialization
  // boundary, so the harness records their names and an isFiber validity
  // check instead of the fiber objects the api hands back
  areUpdatedFibersValid: boolean;
  filePaths: string[];
  staleNames: (string | null)[];
  updatedFiberNames: (string | null)[];
  updatedNames: (string | null)[];
  updatedSourceFileNames: (string | null)[];
}

interface BippyHmrHarness {
  refreshUpdates: BippyRefreshUpdateRecord[];
  hasRefreshListener: boolean;
}

declare global {
  interface Window {
    __BIPPY_HMR__: BippyHmrHarness;
  }
}

export const installHmrHarness = () => {
  if (typeof window === "undefined" || window.__BIPPY_HMR__) return;
  const harness: BippyHmrHarness = { refreshUpdates: [], hasRefreshListener: false };
  window.__BIPPY_HMR__ = harness;
  const refreshListener = onReactRefresh(async (update) => {
    const record: BippyRefreshUpdateRecord = {
      areUpdatedFibersValid: update.updatedFibers.every((fiber) => isFiber(fiber)),
      filePaths: update.filePaths,
      staleNames: update.staleComponents.map((componentType) => getDisplayName(componentType)),
      updatedFiberNames: update.updatedFibers.map((fiber) => getDisplayName(fiber.type)),
      updatedNames: update.updatedComponents.map((componentType) => getDisplayName(componentType)),
      updatedSourceFileNames: [],
    };
    harness.refreshUpdates.push(record);
    const { updatedSources } = await update.getSources();
    record.updatedSourceFileNames = updatedSources.map((source) => source?.fileName ?? null);
  });
  harness.hasRefreshListener = refreshListener !== null;
};
