import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../harness/snapshot.js";

export type FrameworkKind = "spa" | "next-app" | "next-pages" | "react-router";

// A framework inserts its own components between the application's components
// (routers, error boundaries, layout segments). The static tree only knows the
// application plus whatever the route adapter synthesizes; the profile names
// the fibers to splice out on each side so both describe the same hierarchy.
// Anonymous fibers are matched by their work tag name (e.g. "ContextProvider"
// for a provider whose context has no displayName). Context providers are kept
// apart from components because their displayNames (`Navigation`, `Location`,
// `Router`) are common application component names.
export interface FrameworkProfile {
  kind: FrameworkKind;
  /** Spliced out by the comparison wherever the static tree has no fiber for them. */
  transparentRuntimeFibers: ReadonlySet<string>;
  transparentRuntimeProviders: ReadonlySet<string>;
  transparentStaticFibers: ReadonlySet<string>;
  /**
   * Runtime fibers (with their subtrees) the framework or its dev tooling
   * injects with no application counterpart: outlet boundaries, route
   * announcers, asset scripts, devtools panels. A tool that mounts one next to
   * an application element does so from an anonymous wrapper of its own, which
   * is spliced out along with the injection.
   */
  isInjectedRuntimeFiber: (fiber: RuntimeFiberSnapshot) => boolean;
  /** Fiber name both trees are aligned on when the corpus entry does not name one. */
  defaultAnchor: string | null;
}

/** A framework wrapper the comparison may splice out where the static tree has no fiber for it. */
export const isTransparentRuntimeFiber = (
  fiber: RuntimeFiberSnapshot,
  profile: FrameworkProfile,
): boolean => {
  const name = fiber.name ?? fiber.tag;
  return fiber.tag === "ContextProvider"
    ? profile.transparentRuntimeProviders.has(name)
    : profile.transparentRuntimeFibers.has(name);
};

const dropInjectedFiber = (
  fiber: RuntimeFiberSnapshot,
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] => {
  if (profile.isInjectedRuntimeFiber(fiber)) return [];
  const children = dropInjectedList(fiber.children, profile);
  const isInjectionWrapper =
    fiber.name === null && fiber.children.some(profile.isInjectedRuntimeFiber);
  return isInjectionWrapper ? children : [{ ...fiber, children }];
};

const dropInjectedList = (
  fibers: RuntimeFiberSnapshot[],
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] => fibers.flatMap((fiber) => dropInjectedFiber(fiber, profile));

const mapRoots = (
  snapshot: RuntimeSnapshot,
  mapChildren: (children: RuntimeFiberSnapshot[]) => RuntimeFiberSnapshot[],
): RuntimeSnapshot => ({
  ...snapshot,
  roots: snapshot.roots.map((root) => ({ ...root, children: mapChildren(root.children) })),
});

/** Drops the subtrees the framework injects with no application counterpart; transparent wrappers stay for the comparison to splice where the static tree lacks them. */
export const dropInjectedFibers = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
): RuntimeSnapshot => mapRoots(snapshot, (children) => dropInjectedList(children, profile));

const spliceTransparentList = (
  fibers: RuntimeFiberSnapshot[],
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] =>
  fibers.flatMap((fiber) => {
    const children = spliceTransparentList(fiber.children, profile);
    return isTransparentRuntimeFiber(fiber, profile) ? children : [{ ...fiber, children }];
  });

/** The application hierarchy alone: injected subtrees dropped and every transparent wrapper spliced out. */
export const flattenTransparentFibers = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
): RuntimeSnapshot =>
  mapRoots(dropInjectedFibers(snapshot, profile), (children) =>
    spliceTransparentList(children, profile),
  );

const neverInjected = (): boolean => false;

export const SPA_PROFILE: FrameworkProfile = {
  kind: "spa",
  transparentRuntimeFibers: new Set(),
  transparentRuntimeProviders: new Set(),
  transparentStaticFibers: new Set(),
  isInjectedRuntimeFiber: neverInjected,
  defaultAnchor: null,
};
