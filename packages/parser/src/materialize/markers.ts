import type { ReactNode } from "react";
import type { ReactModule } from "./react-runtime.js";

/**
 * Components the materializer mounts where the source's value is not one
 * concrete tree. They render their (already materialized) children so React
 * builds the fibers, and `toPattern` reads them back off the fiber tree by name.
 */
export const MARKER_NAMES = {
  branch: "$Branch",
  alternative: "$Alternative",
  repeat: "$Repeat",
  opaque: "$Opaque",
  unknown: "$Unknown",
  text: "$Text",
  suspended: "$Suspended",
  suspenseBoundary: "$SuspenseBoundary",
} as const;

const markerNames: ReadonlySet<string> = new Set(Object.values(MARKER_NAMES));

export const isMarkerName = (name: string | null): boolean =>
  name !== null && markerNames.has(name);

interface MarkerChildrenProps {
  children?: ReactNode;
}

/** Props every decision marker carries so a replay can find the same decision again. */
interface DecisionMarkerProps extends MarkerChildrenProps {
  location: string | null;
  /** Digest of the decision's structural path, numbered per decision scope in materialization order. */
  decision: string;
  /** The alternatives (or iterations) were materialized in the enclosing decision scope, not one of their own. */
  sharesScope: boolean;
}

interface BranchMarkerProps extends DecisionMarkerProps {
  reason: string;
  preferredIndex: number | null;
  /** Identity of the decision; branches sharing one are selected together. */
  predicate: string | null;
  /** The only alternative rendered, when a replay pinned this branch. */
  pinnedIndex: number | null;
}

interface RepeatMarkerProps extends DecisionMarkerProps {
  /** Serialized `SymbolicCardinality`; null when the iterated collection is not an input the analysis can name. */
  cardinality: string | null;
  countMin: number;
  countMax: number | null;
  /** How many iterations were rendered, when a replay pinned this repeat. */
  pinnedCount: number | null;
}

interface OpaqueMarkerProps extends MarkerChildrenProps {
  displayName: string | null;
  importedName: string | null;
  packageName: string | null;
  reason: string;
}

interface UnknownMarkerProps {
  reason: string;
  /** The subtree was not materialized, so the states below it are not enumerated. */
  isTruncated: boolean;
}

export const TEXT_PLACEHOLDER = "\u2026";
/** Stands in for a key the build alone knows, or none: a fragment React must not unwrap mounts as a fiber with it. */
export const KEY_PLACEHOLDER = "\u2026";

const named = <T extends (...args: never[]) => unknown>(name: string, component: T): T =>
  Object.defineProperty(component, "name", { value: name });

export const BranchMarker = named(
  MARKER_NAMES.branch,
  ({ children }: BranchMarkerProps): ReactNode => children,
);

export const AlternativeMarker = named(
  MARKER_NAMES.alternative,
  ({ children }: MarkerChildrenProps): ReactNode => children,
);

export const RepeatMarker = named(
  MARKER_NAMES.repeat,
  ({ children }: RepeatMarkerProps): ReactNode => children,
);

export const OpaqueMarker = named(
  MARKER_NAMES.opaque,
  ({ children }: OpaqueMarkerProps): ReactNode => children,
);

export const UnknownMarker = named(
  MARKER_NAMES.unknown,
  (_props: UnknownMarkerProps): null => null,
);

export const TextMarker = named(MARKER_NAMES.text, (): string => TEXT_PLACEHOLDER);

const NEVER_RESOLVES = new Promise<never>(() => {});

/**
 * Stands in for primary children that may be suspended when the tree is
 * observed. Suspends through `use` where React has it: a thrown promise takes
 * the deprecated unwind path that schedules a retry per boundary, and two
 * boundaries with pending retries keep re-committing each other forever.
 */
export const createSuspendedMarker = (use: ReactModule["use"] | undefined) =>
  named(MARKER_NAMES.suspended, (): never => {
    if (!use) throw NEVER_RESOLVES;
    return use(NEVER_RESOLVES);
  });
