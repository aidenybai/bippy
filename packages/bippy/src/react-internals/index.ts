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

interface InheritedWorkTags {
  workTags: Readonly<ReactWorkTagMap>;
  generation: number;
}

const defaultReactWorkTags = getReactWorkTags();
const fiberReactWorkTags = new WeakMap<Fiber, Readonly<ReactWorkTagMap>>();
const inheritedFiberWorkTags = new WeakMap<Fiber, InheritedWorkTags>();
let workTagGeneration = 0;

const getCachedWorkTags = (fiber: Fiber): Readonly<ReactWorkTagMap> | undefined => {
  const assignedWorkTags = fiberReactWorkTags.get(fiber);
  if (assignedWorkTags) return assignedWorkTags;
  const inheritedWorkTags = inheritedFiberWorkTags.get(fiber);
  return inheritedWorkTags?.generation === workTagGeneration
    ? inheritedWorkTags.workTags
    : undefined;
};

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
  if (
    getCachedWorkTags(fiber) !== workTags ||
    (fiber.alternate && getCachedWorkTags(fiber.alternate) !== workTags)
  ) {
    workTagGeneration++;
  }
  fiberReactWorkTags.set(fiber, workTags);
  if (fiber.alternate) fiberReactWorkTags.set(fiber.alternate, workTags);
};

export const getReactWorkTagsForFiber = (fiber: Fiber): Readonly<ReactWorkTagMap> => {
  let workTags = getCachedWorkTags(fiber);
  if (workTags) return workTags;
  const traversedFibers: Fiber[] = [];
  let ancestor = fiber;
  while (!workTags) {
    traversedFibers.push(ancestor);
    const parent = ancestor.return;
    if (!parent) {
      workTags = inheritedFiberWorkTags.get(ancestor)?.workTags ?? defaultReactWorkTags;
      break;
    }
    ancestor = parent;
    workTags = getCachedWorkTags(ancestor);
  }
  const inheritedWorkTags = { workTags, generation: workTagGeneration };
  for (const traversedFiber of traversedFibers) {
    inheritedFiberWorkTags.set(traversedFiber, inheritedWorkTags);
    if (traversedFiber.alternate) {
      inheritedFiberWorkTags.set(traversedFiber.alternate, inheritedWorkTags);
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
