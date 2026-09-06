import "bippy/install-hook-only";
import { type FiberRoot, instrument } from "bippy";
import { snapshotRuntimeFiber } from "../harness/runtime-snapshot.js";
import type { FiberSnapshot } from "../snapshot/types.js";

/**
 * Browser side of live verification. Bundled and injected as an init script
 * so the DevTools hook exists before the page's React DOM registers, then
 * queried from Playwright once the app has settled.
 */
export interface CaptureGlobal {
  getCommitCount: () => number;
  /** One snapshot per root React has committed to, in first-commit order. */
  snapshot: () => FiberSnapshot[];
}

declare global {
  interface Window {
    __BIPPY_PARSER_CAPTURE__: CaptureGlobal;
  }
}

const roots = new Set<FiberRoot>();
let commitCount = 0;

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    roots.add(root);
    commitCount++;
  },
});

window.__BIPPY_PARSER_CAPTURE__ = {
  getCommitCount: () => commitCount,
  snapshot: () => [...roots].map((root) => snapshotRuntimeFiber(root.current)),
};
