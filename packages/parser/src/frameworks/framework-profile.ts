import { isBundlerDedupedName } from "../harness/bundler-names.js";
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

const isReExportWrapper = (
  fiber: RuntimeFiberSnapshot,
  children: RuntimeFiberSnapshot[],
): boolean =>
  fiber.name !== null &&
  children.length === 1 &&
  children[0].name !== null &&
  isBundlerDedupedName(children[0].name, fiber.name);

const isTransparentRuntimeFiber = (
  fiber: RuntimeFiberSnapshot,
  profile: FrameworkProfile,
): boolean => {
  const name = fiber.name ?? fiber.tag;
  return fiber.tag === "ContextProvider"
    ? profile.transparentRuntimeProviders.has(name)
    : profile.transparentRuntimeFibers.has(name);
};

const flattenFiber = (
  fiber: RuntimeFiberSnapshot,
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] => {
  if (profile.isInjectedRuntimeFiber(fiber)) return [];
  const children = flattenList(fiber.children, profile);
  const isInjectionWrapper =
    fiber.name === null && fiber.children.some(profile.isInjectedRuntimeFiber);
  if (isInjectionWrapper || isTransparentRuntimeFiber(fiber, profile)) return children;
  if (isReExportWrapper(fiber, children)) return children;
  return [{ ...fiber, children }];
};

const flattenList = (
  fibers: RuntimeFiberSnapshot[],
  profile: FrameworkProfile,
): RuntimeFiberSnapshot[] => {
  const result: RuntimeFiberSnapshot[] = [];
  for (const fiber of fibers) result.push(...flattenFiber(fiber, profile));
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
    children: flattenList(root.children, profile),
  })),
});

const neverInjected = (): boolean => false;

export const SPA_PROFILE: FrameworkProfile = {
  kind: "spa",
  transparentRuntimeFibers: new Set(),
  transparentRuntimeProviders: new Set(),
  transparentStaticFibers: new Set(),
  isInjectedRuntimeFiber: neverInjected,
  defaultAnchor: null,
};
