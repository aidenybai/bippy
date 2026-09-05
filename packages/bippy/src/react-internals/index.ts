import { getReactWorkTags, ReactFiberFlags } from "./generated/react-work-tags.js";
import type { ReactWorkTagMap } from "./generated/react-work-tags.js";
import { isSemver } from "./semver.js";
import type { Fiber, ReactRenderer } from "./types.js";

export { compareSemver } from "./semver.js";
export {
  getReactWorkTags,
  ReactBuildType,
  ReactFiberFlags,
  ReactSymbols,
} from "./generated/react-work-tags.js";
export type {
  HostWorkTag,
  ReactWorkTag,
  ReactWorkTagMap,
  ReactWorkTagVersion,
} from "./generated/react-work-tags.js";
export * from "./types.js";

const defaultReactWorkTags = getReactWorkTags();
const fiberReactWorkTags = new WeakMap<Fiber, Readonly<ReactWorkTagMap>>();

// React's experimental channel historically reported "0.0.0-experimental-<sha>"
// as the runtime version; those builds use modern work tags, not the 16.x rows
// the version table would resolve "0.0.0" to.
const getReactWorkTagsForVersion = (version: string): Readonly<ReactWorkTagMap> =>
  version.startsWith("0.0.0-") ? defaultReactWorkTags : getReactWorkTags(version);

export const getReactWorkTagsForRenderer = (
  renderer?: ReactRenderer | null,
): Readonly<ReactWorkTagMap> => {
  const reconcilerVersion = renderer?.reconcilerVersion;
  if (reconcilerVersion && isSemver(reconcilerVersion)) {
    return getReactWorkTagsForVersion(reconcilerVersion);
  }
  return renderer?.version ? getReactWorkTagsForVersion(renderer.version) : defaultReactWorkTags;
};

export const setReactWorkTagsForFiber = (fiber: Fiber, renderer?: ReactRenderer): void => {
  const workTags = getReactWorkTagsForRenderer(renderer);
  fiberReactWorkTags.set(fiber, workTags);
  if (fiber.alternate) fiberReactWorkTags.set(fiber.alternate, workTags);
};

export const getReactWorkTagsForFiber = (fiber: Fiber): Readonly<ReactWorkTagMap> => {
  const cachedWorkTags = fiberReactWorkTags.get(fiber);
  if (cachedWorkTags) return cachedWorkTags;

  const traversedFibers: Fiber[] = [fiber];
  let rootFiber = fiber;
  let workTags = defaultReactWorkTags;
  while (rootFiber.return) {
    rootFiber = rootFiber.return;
    const ancestorWorkTags = fiberReactWorkTags.get(rootFiber);
    if (ancestorWorkTags) {
      workTags = ancestorWorkTags;
      break;
    }
    traversedFibers.push(rootFiber);
  }
  for (const traversedFiber of traversedFibers) {
    fiberReactWorkTags.set(traversedFiber, workTags);
    if (traversedFiber.alternate) {
      fiberReactWorkTags.set(traversedFiber.alternate, workTags);
    }
  }
  return workTags;
};

export const MutationMask =
  ReactFiberFlags.Placement |
  ReactFiberFlags.Update |
  ReactFiberFlags.ChildDeletion |
  ReactFiberFlags.ContentReset |
  ReactFiberFlags.Hydrating |
  ReactFiberFlags.Visibility |
  ReactFiberFlags.Snapshot;
