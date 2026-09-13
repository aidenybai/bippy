import { MARKER_NAMES } from "../materialize/markers.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../harness/snapshot.js";
import type { StaticRenderStats } from "../types.js";

/** Counts what React actually committed, so the numbers describe the captured tree rather than materialization work. */
export const computeRenderStats = (
  snapshot: RuntimeSnapshot,
  modulesLoaded: number,
): StaticRenderStats => {
  const stats: StaticRenderStats = {
    fiberCount: 0,
    textCount: 0,
    branchCount: 0,
    repeatCount: 0,
    opaqueCount: 0,
    unknownCount: 0,
    modulesLoaded,
  };
  const visit = (fiber: RuntimeFiberSnapshot): void => {
    stats.fiberCount++;
    if (fiber.text !== null || fiber.name === MARKER_NAMES.text) stats.textCount++;
    switch (fiber.name) {
      case MARKER_NAMES.branch:
        stats.branchCount++;
        break;
      case MARKER_NAMES.repeat:
        stats.repeatCount++;
        break;
      case MARKER_NAMES.opaque:
        stats.opaqueCount++;
        break;
      case MARKER_NAMES.unknown:
        stats.unknownCount++;
        break;
    }
    for (const child of fiber.children) visit(child);
  };
  for (const root of snapshot.roots) visit(root);
  return stats;
};
