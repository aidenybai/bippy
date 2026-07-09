import * as bippyHmr from "bippy/react-refresh";

interface BippyHmrHarness {
  hmr: typeof bippyHmr;
  updates: string[][];
  hasTransport: boolean | null;
}

declare global {
  interface Window {
    __BIPPY_HMR__: BippyHmrHarness;
  }
}

export const installHmrHarness = () => {
  if (typeof window === "undefined" || window.__BIPPY_HMR__) return;
  const harness: BippyHmrHarness = { hmr: bippyHmr, updates: [], hasTransport: null };
  window.__BIPPY_HMR__ = harness;
  void bippyHmr
    .detectHmrTransport((filePaths) => {
      harness.updates.push(filePaths);
    })
    .then((transport) => {
      harness.hasTransport = transport !== null;
    });
};
