export type MountFailure =
  | "server-component"
  | "env"
  | "node-global"
  | "module"
  | "provider"
  | "missing-data"
  | "navigation"
  | "did-not-render"
  | "too-large"
  | "unresponsive"
  | "other";

interface MountFailurePattern {
  failure: MountFailure;
  pattern: RegExp;
}

/**
 * Why a component couldn't mount, read from its error. Each failure points at a different
 * fix: an async server component can't mount in a browser at all, while a missing provider
 * or environment variable is the harness's job to supply.
 */
const MOUNT_FAILURE_PATTERNS: MountFailurePattern[] = [
  {
    failure: "server-component",
    pattern:
      /found: \[object Promise\]|async\/await is not yet supported in Client Components|async server component/,
  },
  { failure: "env", pattern: /environment variable/i },
  {
    failure: "node-global",
    pattern: /\b(?:__dirname|__filename|Buffer|process|require|global) is not defined/,
  },
  {
    failure: "module",
    pattern:
      /requested module|Failed to resolve import|Failed to fetch dynamically imported module|does not provide an export|Element type is invalid|should not be imported outside/,
  },
  {
    failure: "provider",
    pattern:
      /must be (?:either )?(?:used|placed|rendered) (?:within|inside)|descendant of|used outside|can only be used within|context (?:from `?\w+`? )?was not found|No \w+ context found|of '(?:React\.)?useContext\(|Provider was not found|outside of a `?<\w+>|expected app router to be mounted|inside another <Router>/i,
  },
  {
    failure: "missing-data",
    pattern:
      /Cannot read properties of (?:undefined|null)|is not a function|Cannot destructure|Invalid time value/,
  },
  { failure: "navigation", pattern: /Execution context was destroyed/ },
  { failure: "did-not-render", pattern: /did not render/ },
  { failure: "too-large", pattern: /rendered more than \d+ fibers/ },
  { failure: "unresponsive", pattern: /page stopped responding/ },
];

export const classifyMountError = (message: string): MountFailure =>
  MOUNT_FAILURE_PATTERNS.find(({ pattern }) => pattern.test(message))?.failure ?? "other";
