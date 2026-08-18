"use client";

import * as bippy from "bippy";
import { useEffect } from "react";

declare global {
  interface Window {
    __BIPPY__: typeof bippy;
    __COMMIT_COUNT__: number;
    __HMR_EFFECT_LOG__: string[];
    __BIPPY_PROBE_READY__: boolean;
  }
}

let didInstrument = false;
const instrumentOnce = (): void => {
  if (didInstrument) return;
  didInstrument = true;
  window.__BIPPY__ = bippy;
  window.__COMMIT_COUNT__ = window.__COMMIT_COUNT__ ?? 0;
  window.__HMR_EFFECT_LOG__ = window.__HMR_EFFECT_LOG__ ?? [];
  bippy.instrument({
    onCommitFiberRoot: () => {
      window.__COMMIT_COUNT__++;
    },
  });
};

if (typeof window !== "undefined") {
  instrumentOnce();
}

export const BippyProbe = () => {
  useEffect(() => {
    window.__BIPPY_PROBE_READY__ = true;
  }, []);
  return null;
};
