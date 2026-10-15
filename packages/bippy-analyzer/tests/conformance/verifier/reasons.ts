import type { Capture } from "./types";

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const message: unknown =
    typeof error === "object" && error ? Reflect.get(error, "message") : null;
  return typeof message === "string" ? message : String(error);
};

export const getErrorChain = (error: unknown): string => {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  return cause === undefined
    ? getErrorMessage(error)
    : `${getErrorMessage(error)}: ${getErrorChain(cause)}`;
};

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
      /must be (?:either )?(?:used|placed|rendered) (?:within|inside)|has to be used within|descendant of|used outside|can only be used within|context (?:from `?\w+`? )?was not found|No \w+ context found|of '(?:React\.)?useContext\(|Provider was not found|outside of a `?<\w+>|expected app router to be mounted|inside another <Router>|<[A-Z][\w.]*> is missing|outside of an? [A-Z]|must be placed in <|must be wrapped in a <\w+/i,
  },
  {
    failure: "missing-data",
    pattern:
      /Cannot read properties of (?:undefined|null)|is not a function|Cannot destructure|Invalid time value/,
  },
  { failure: "navigation", pattern: /Execution context was destroyed/ },
];

const PARENT_NAME_PATTERNS = [
  /(?:within|inside|outside of|outside|from|descendant of|placed in)\s+(?:an?\s+|the\s+)?[<`]{0,2}([A-Z]\w*(?:\.[A-Z]\w*)?)/,
  /([A-Z]\w*Provider) was not found/,
  /<([A-Z]\w*(?:\.[A-Z]\w*)?)> is missing/,
  /wrapped in a <([A-Z]\w*)/,
];

export const extractParentNameFromError = (message: string): string | null =>
  PARENT_NAME_PATTERNS.map((pattern) => pattern.exec(message)?.[1]).find(Boolean) ?? null;

export class HarnessError extends Error {
  readonly failure: MountFailure;

  constructor(failure: MountFailure, message: string) {
    super(message);
    this.failure = failure;
  }
}

export const getCaptureFailure = (capture: Capture): MountFailure =>
  capture.failure ?? classifyMountError(capture.error ?? "");

export const classifyMountError = (message: string): MountFailure =>
  MOUNT_FAILURE_PATTERNS.find(({ pattern }) => pattern.test(message))?.failure ?? "other";
