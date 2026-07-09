import { getDisplayName } from "bippy";
import { onReactRefresh } from "bippy/react-refresh";

interface BippyRefreshUpdateRecord {
  staleNames: (string | null)[];
  updatedNames: (string | null)[];
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
  const refreshListener = onReactRefresh((update) => {
    harness.refreshUpdates.push({
      staleNames: update.staleComponents.map((componentType) => getDisplayName(componentType)),
      updatedNames: update.updatedComponents.map((componentType) => getDisplayName(componentType)),
    });
  });
  harness.hasRefreshListener = refreshListener !== null;
};
