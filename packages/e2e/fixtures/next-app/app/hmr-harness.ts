import { getDisplayName } from "bippy";
import * as bippyHmr from "bippy/react-refresh";

interface BippyRefreshUpdateRecord {
  staleNames: (string | null)[];
  updatedNames: (string | null)[];
}

interface BippyHmrHarness {
  hmr: typeof bippyHmr;
  updates: string[][];
  refreshUpdates: BippyRefreshUpdateRecord[];
  hasTransport: boolean | null;
  hasRefreshListener: boolean;
}

declare global {
  interface Window {
    __BIPPY_HMR__: BippyHmrHarness;
  }
}

export const installHmrHarness = () => {
  if (typeof window === "undefined" || window.__BIPPY_HMR__) return;
  const harness: BippyHmrHarness = {
    hmr: bippyHmr,
    updates: [],
    refreshUpdates: [],
    hasTransport: null,
    hasRefreshListener: false,
  };
  window.__BIPPY_HMR__ = harness;
  const refreshListener = bippyHmr.onReactRefresh((update) => {
    harness.refreshUpdates.push({
      staleNames: Array.from(update.staleFamilies, (family) => getDisplayName(family.current)),
      updatedNames: Array.from(update.updatedFamilies, (family) => getDisplayName(family.current)),
    });
  });
  harness.hasRefreshListener = refreshListener !== null;
  void bippyHmr
    .detectHmrTransport((filePaths) => {
      harness.updates.push(filePaths);
    })
    .then((transport) => {
      harness.hasTransport = transport !== null;
    });
};
