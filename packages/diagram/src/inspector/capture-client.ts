import { detectReactBuildType, getFiberId, getRDTHook, instrument, type FiberRoot } from "bippy";
import { getFiberSnapshot } from "./fiber-snapshot";
import {
  maxCapturedFibers,
  type CapturedFiberRoot,
  type FiberCapture,
} from "./inspection-protocol";

declare global {
  interface Window {
    __bippyDiagramCapture?: (capture: FiberCapture) => Promise<void>;
  }
}

const documentId = [...crypto.getRandomValues(new Uint32Array(4))]
  .map((value) => value.toString(16))
  .join("-");
const roots = new Map<FiberRoot, number>();
let pendingCapture: ReturnType<typeof setTimeout> | undefined;
let isStopped = false;

const publish = () => {
  pendingCapture = undefined;
  if (isStopped) return;
  const hook = getRDTHook();
  const capturedRoots: CapturedFiberRoot[] = [];
  let remaining = maxCapturedFibers;
  let isTruncated = false;
  for (const [root, rendererId] of roots) {
    if (remaining === 0 || capturedRoots.length === 100) {
      isTruncated = true;
      break;
    }
    const renderer = hook?.renderers.get(rendererId);
    if (!renderer || !root.current.child) continue;
    const snapshot = getFiberSnapshot(root.current, remaining);
    remaining -= snapshot.nodes.length + snapshot.details.length;
    isTruncated ||= snapshot.truncated;
    capturedRoots.push({
      id: `root-${rendererId}-${getFiberId(root.current)}`,
      rendererId,
      reactVersion: renderer.version || "unknown",
      build: detectReactBuildType(renderer),
      ...snapshot,
    });
  }
  void window
    .__bippyDiagramCapture?.({ documentId, roots: capturedRoots, truncated: isTruncated })
    .catch(() => undefined);
};

const scheduleCapture = () => {
  if (pendingCapture !== undefined || isStopped) return;
  // HACK: Coalesce commit bursts so chart animations cannot flood the inspector.
  pendingCapture = setTimeout(publish, 100);
};

const unsubscribe = instrument({
  name: "diagram-live-inspector",
  onCommitFiberRoot: (rendererId, root) => {
    if (root.current.child) roots.set(root, rendererId);
    else roots.delete(root);
    scheduleCapture();
  },
  onPostCommitFiberRoot: scheduleCapture,
});

window.addEventListener("pageshow", scheduleCapture);
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  // HACK: Firefox's frame init realm survives the placeholder about:blank pagehide.
  if (document.URL === "about:blank") return;
  isStopped = true;
  clearTimeout(pendingCapture);
  unsubscribe();
  roots.clear();
});
