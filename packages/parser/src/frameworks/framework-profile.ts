import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../harness/snapshot.js";

export type FrameworkKind = "spa" | "next-app" | "next-pages" | "react-router";

// A framework inserts its own components between the application's components
// (routers, error boundaries, layout segments). The static tree only knows the
// application plus whatever the route adapter synthesizes; the profile names
// the fibers to splice out on each side so both describe the same hierarchy.
// Anonymous fibers are matched by their work tag name (e.g. "ContextProvider"
// for a provider whose context has no displayName).
export interface FrameworkProfile {
  kind: FrameworkKind;
  /** Spliced out by the comparison wherever the static tree has no fiber for them. */
  transparentRuntimeFibers: ReadonlySet<string>;
  transparentStaticFibers: ReadonlySet<string>;
  /**
   * Runtime fibers (with their subtrees) the framework injects with no
   * application counterpart: outlet boundaries, route announcers, asset scripts.
   */
  isInjectedRuntimeFiber: (fiber: RuntimeFiberSnapshot) => boolean;
  /** Fiber name both trees are aligned on when the corpus entry does not name one. */
  defaultAnchor: string | null;
}

const dropInjectedList = (
  fibers: RuntimeFiberSnapshot[],
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] =>
  fibers
    .filter((fiber) => !profile.isInjectedRuntimeFiber(fiber))
    .map((fiber) => ({ ...fiber, children: dropInjectedList(fiber.children, profile) }));

/** Drops the subtrees the framework injects with no application counterpart. */
export const dropInjectedFibers = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
): RuntimeSnapshot => ({
  ...snapshot,
  roots: snapshot.roots.map((root) => ({
    ...root,
    children: dropInjectedList(root.children, profile),
  })),
});

export const neverInjected = (): boolean => false;

export const SPA_PROFILE: FrameworkProfile = {
  kind: "spa",
  transparentRuntimeFibers: new Set(),
  transparentStaticFibers: new Set(),
  isInjectedRuntimeFiber: neverInjected,
  defaultAnchor: null,
};
