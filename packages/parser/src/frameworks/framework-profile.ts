import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../harness/snapshot.js";

export type FrameworkKind = "spa" | "next-app" | "next-pages" | "react-router";

// A framework inserts its own components between the application's components
// (routers, error boundaries, layout segments). The static tree only knows the
// application plus whatever the route adapter synthesizes; the profile names
// the fibers to splice out on each side so both describe the same hierarchy.
export interface FrameworkProfile {
  kind: FrameworkKind;
  transparentRuntimeFibers: ReadonlySet<string>;
  transparentStaticFibers: ReadonlySet<string>;
  /** Fiber name both trees are aligned on when the corpus entry does not name one. */
  defaultAnchor: string | null;
}

const flattenFiber = (
  fiber: RuntimeFiberSnapshot,
  transparent: ReadonlySet<string>,
): RuntimeFiberSnapshot[] => {
  const children = flattenList(fiber.children, transparent);
  if (fiber.name !== null && transparent.has(fiber.name)) return children;
  return [{ ...fiber, children }];
};

const flattenList = (
  fibers: RuntimeFiberSnapshot[],
  transparent: ReadonlySet<string>,
): RuntimeFiberSnapshot[] => {
  const result: RuntimeFiberSnapshot[] = [];
  for (const fiber of fibers) result.push(...flattenFiber(fiber, transparent));
  return result;
};

export const flattenTransparentFibers = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
): RuntimeSnapshot => {
  if (profile.transparentRuntimeFibers.size === 0) return snapshot;
  return {
    ...snapshot,
    roots: snapshot.roots.map((root) => ({
      ...root,
      children: flattenList(root.children, profile.transparentRuntimeFibers),
    })),
  };
};

export const SPA_PROFILE: FrameworkProfile = {
  kind: "spa",
  transparentRuntimeFibers: new Set(),
  transparentStaticFibers: new Set(),
  defaultAnchor: null,
};
