import { getReactWorkTags, ReactFiberFlags } from "./generated/react-work-tags.js";
import type { ReactWorkTagMap } from "./generated/react-work-tags.js";
import { compareSemver } from "./semver.js";
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

const defaultReactWorkTags = getReactWorkTags("");
const fiberReactWorkTags = new WeakMap<Fiber, Readonly<ReactWorkTagMap>>();

export const getReactWorkTagsForRenderer = (
  renderer?: ReactRenderer | null,
): Readonly<ReactWorkTagMap> => {
  const reconcilerVersion = renderer?.reconcilerVersion;
  if (reconcilerVersion && compareSemver(reconcilerVersion, reconcilerVersion) === 0) {
    return getReactWorkTags(reconcilerVersion);
  }
  return getReactWorkTags(renderer?.version ?? "");
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
  while (rootFiber.return) {
    rootFiber = rootFiber.return;
    traversedFibers.push(rootFiber);
  }
  const workTags = fiberReactWorkTags.get(rootFiber) ?? defaultReactWorkTags;
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
