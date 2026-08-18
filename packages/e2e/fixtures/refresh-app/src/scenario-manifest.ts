// Imported by both the in-page scenario registry (to guarantee every listed
// scenario exists) and the Playwright specs (to declare one test per
// scenario). Keep this file dependency-free so specs can import it in node.

export interface ScenarioDescriptor {
  name: string;
  // Some scenarios rely on APIs missing from older ReactDOM majors.
  minReactMajor?: 18 | 19;
  // Documented divergence between published react packages and React main.
  // Specs mark these as expected failures so an upgrade that fixes the
  // behavior upstream flips them to "unexpected pass" and gets noticed.
  knownIssue?: string;
}

// Fixed on React main by facebook/react#36950 and #36964 (kind-changing
// edits crash or are dropped), but the fixes have not shipped in the
// published react-refresh 0.18.0 / react-dom 19.2.4 pair yet.
const KIND_CHANGE_ISSUE =
  "kind-changing edits require facebook/react#36950/#36964, unreleased as of react-refresh 0.18.0";

const STRICT_MODE_REMOUNT_ISSUE =
  "react-dom 19.2.4 does not double-invoke effects for Fast Refresh forced remounts; React main does";

export const scenarioManifest: readonly ScenarioDescriptor[] = [
  { name: "preserves state for compatible types" },
  { name: "preserves state for forwardRef" },
  { name: "does not consider two forwardRefs around the same type equivalent" },
  { name: "updates forwardRef render function together with its wrapper" },
  { name: "updates forwardRef render function in isolation" },
  { name: "preserves state for simple memo" },
  { name: "preserves state for memo with custom comparison" },
  { name: "updates simple memo function in isolation" },
  { name: "preserves state for memo(forwardRef)" },
  { name: "does not leak state between components" },
  {
    name: "resets state when switching between different component types",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  { name: "remounts when function changes to memo", knownIssue: KIND_CHANGE_ISSUE },
  { name: "remounts when memo changes to forwardRef", knownIssue: KIND_CHANGE_ISSUE },
  { name: "remounts when function changes to forwardRef", knownIssue: KIND_CHANGE_ISSUE },
  {
    name: "remounts when memo inner type changes from function to forwardRef",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  {
    name: "mounts an element created before its type changed kinds",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  {
    name: "remounts when adding or removing a memo comparison function",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  { name: "updates a memo comparison function in place", knownIssue: KIND_CHANGE_ISSUE },
  {
    name: "mounts a pre-edit memo element with the latest comparison function",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  {
    name: "remounts an unregistered memo wrapper without losing the wrapper",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  { name: "preserves state for lazy after resolution" },
  { name: "patches lazy before resolution" },
  { name: "patches lazy(forwardRef) before resolution" },
  { name: "patches lazy(memo) before resolution" },
  { name: "patches lazy(memo(forwardRef)) before resolution" },
  {
    name: "remounts lazy(memo()) when adding a comparison function",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  {
    name: "remounts lazy(memo()) when adding a comparison without re-creating the lazy",
    knownIssue: KIND_CHANGE_ISSUE,
  },
  { name: "can force remount by changing signature" },
  { name: "keeps a valid tree when forcing remount" },
  { name: "remounts on signature change within a root wrapper" },
  { name: "remounts on signature change within a simple memo wrapper" },
  { name: "remounts on signature change within a lazy simple memo wrapper" },
  { name: "remounts on signature change within forwardRef" },
  { name: "remounts on signature change within forwardRef render function" },
  { name: "remounts on signature change within nested memo" },
  { name: "remounts on signature change within a memo wrapper and custom comparison" },
  { name: "remounts on signature change within a class" },
  { name: "remounts on signature change within a context provider" },
  { name: "remounts on signature change within a context consumer" },
  { name: "remounts on signature change within a suspense node" },
  { name: "remounts on signature change within a mode node" },
  { name: "remounts on signature change within a fragment node" },
  { name: "remounts on signature change within multiple siblings" },
  { name: "remounts on signature change within a profiler node" },
  { name: "resets hooks with dependencies on hot reload" },
  { name: "does not get into infinite loops during render phase updates" },
  { name: "does not re-render ancestor components unnecessarily during a hot update" },
  { name: "batches re-renders during a hot update" },
  {
    name: "double invokes effects after a forced remount in StrictMode",
    minReactMajor: 18,
    knownIssue: STRICT_MODE_REMOUNT_ISSUE,
  },
  {
    name: "double invokes an effect added during a Fast Refresh remount in StrictMode",
    minReactMajor: 18,
    knownIssue: STRICT_MODE_REMOUNT_ISSUE,
  },
  { name: "remounts failed error boundaries (componentDidCatch)" },
  { name: "remounts failed error boundaries (getDerivedStateFromError)" },
  { name: "remounts error boundaries that failed asynchronously after hot update" },
  { name: "remounts a failed root on mount", minReactMajor: 19 },
  { name: "does not retry an intentionally unmounted failed root", minReactMajor: 19 },
  { name: "remounts a failed root on update", minReactMajor: 19 },
  { name: "regression test: does not get into an infinite loop" },
  { name: "remounts classes on every edit" },
  { name: "updates refs when remounting" },
  { name: "remounts on conversion from class to function and back" },
  { name: "can update multiple roots independently" },
  { name: "can detect likely component types" },
  { name: "reports updated and remounted families to the caller" },
  { name: "does not break when an unsupported legacy renderer is injected" },
  { name: "refreshes components rendered by two renderers on one page", minReactMajor: 19 },
];

export const scenarioNames: readonly string[] = scenarioManifest.map(
  (descriptor) => descriptor.name,
);

export const getScenarioNamesForReactMajor = (reactMajor: number): readonly string[] =>
  scenarioManifest
    .filter((descriptor) => reactMajor >= (descriptor.minReactMajor ?? 0))
    .map((descriptor) => descriptor.name);
