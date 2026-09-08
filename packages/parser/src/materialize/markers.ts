import type { ReactNode } from "react";

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

export type MarkerName = (typeof MARKER_NAMES)[keyof typeof MARKER_NAMES];

const markerNames: ReadonlySet<string> = new Set(Object.values(MARKER_NAMES));

export const isMarkerName = (name: string | null): name is MarkerName =>
  name !== null && markerNames.has(name);

export interface MarkerChildrenProps {
  children?: ReactNode;
}

export interface BranchMarkerProps extends MarkerChildrenProps {
  reason: string;
  location: string | null;
  preferredIndex: number | null;
  /** Identity of the decision; branches sharing one are selected together. */
  predicate: string | null;
}

export interface RepeatMarkerProps extends MarkerChildrenProps {
  location: string | null;
  countMin: number;
  countMax: number | null;
}

export interface OpaqueMarkerProps extends MarkerChildrenProps {
  displayName: string | null;
  importedName: string | null;
  packageName: string | null;
  reason: string;
}

export interface UnknownMarkerProps {
  reason: string;
  /** The subtree was not materialized, so the states below it are not enumerated. */
  isTruncated: boolean;
}

export const TEXT_PLACEHOLDER = "\u2026";

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

/**
 * Stands in for a boundary's primary children while it shows its fallback; it
 * renders the fallback so React builds those fibers, and `toPattern` moves them
 * into the fallback fragment React would mount next to the hidden Offscreen.
 */
export const SuspendedMarker = named(
  MARKER_NAMES.suspended,
  ({ children }: MarkerChildrenProps): ReactNode => children,
);
