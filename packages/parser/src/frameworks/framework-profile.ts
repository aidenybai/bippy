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
  transparentRuntimeFibers: ReadonlySet<string>;
  /**
   * Fibers a transparent wrapper renders directly around its children, keyed by
   * the wrapper's name: React's `Activity` -> `Offscreen` pair that Next's
   * `OuterLayoutRouter` keeps each route segment in. An application's own
   * `Activity` elsewhere stays a fiber on both sides.
   */
  transparentRuntimeWrapperChildren: ReadonlyMap<string, ReadonlySet<string>>;
  transparentStaticFibers: ReadonlySet<string>;
  /**
   * Runtime fibers (with their subtrees) the framework injects with no
   * application counterpart: outlet boundaries, route announcers, asset scripts.
   */
  isInjectedRuntimeFiber: (fiber: RuntimeFiberSnapshot) => boolean;
  /** Fiber name both trees are aligned on when the corpus entry does not name one. */
  defaultAnchor: string | null;
}

const flattenFiber = (
  fiber: RuntimeFiberSnapshot,
  profile: FrameworkProfile,
  wrapperName: string | null,
): RuntimeFiberSnapshot[] => {
  if (profile.isInjectedRuntimeFiber(fiber)) return [];
  const name = fiber.name ?? fiber.tag;
  if (profile.transparentRuntimeFibers.has(name)) {
    return flattenList(fiber.children, profile, name);
  }
  if (
    wrapperName !== null &&
    profile.transparentRuntimeWrapperChildren.get(wrapperName)?.has(name)
  ) {
    return flattenList(fiber.children, profile, wrapperName);
  }
  return [{ ...fiber, children: flattenList(fiber.children, profile, null) }];
};

const flattenList = (
  fibers: RuntimeFiberSnapshot[],
  profile: FrameworkProfile,
  wrapperName: string | null,
): RuntimeFiberSnapshot[] => {
  const result: RuntimeFiberSnapshot[] = [];
  for (const fiber of fibers) result.push(...flattenFiber(fiber, profile, wrapperName));
  return result;
};

/** Splices out transparent framework wrappers and drops injected subtrees so the runtime tree describes the application hierarchy. */
export const flattenTransparentFibers = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
): RuntimeSnapshot => ({
  ...snapshot,
  roots: snapshot.roots.map((root) => ({
    ...root,
    children: flattenList(root.children, profile, null),
  })),
});

export const neverInjected = (): boolean => false;

export const SPA_PROFILE: FrameworkProfile = {
  kind: "spa",
  transparentRuntimeFibers: new Set(),
  transparentRuntimeWrapperChildren: new Map(),
  transparentStaticFibers: new Set(),
  isInjectedRuntimeFiber: neverInjected,
  defaultAnchor: null,
};
