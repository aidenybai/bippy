import { readFileSync } from "node:fs";
import path from "node:path";
import type { FrameworkKind } from "../frameworks/framework-profile.js";
import type { ProcessEnvironment } from "../types.js";
import type { CorpusEntry } from "./manifest.js";

const CLIENT_PREFIXES: Record<FrameworkKind, string | null> = {
  "next-app": "NEXT_PUBLIC_",
  "next-pages": "NEXT_PUBLIC_",
  "react-router": "VITE_",
  spa: "VITE_",
};

/** `dotenv`'s `LINE`: `KEY=value` or `KEY: value`, quoted values spanning lines, a trailing `#` comment. */
const DOTENV_LINE =
  /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;

const QUOTED_VALUE = /^(['"`])([\s\S]*)\1$/;

/** `dotenv.parse`: within one file the last assignment of a variable wins and only double quotes expand `\n`. */
export const parseDotenv = (source: string): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const match of source.replaceAll(/\r\n?/g, "\n").matchAll(DOTENV_LINE)) {
    const [, name, rawValue = ""] = match;
    const trimmed = rawValue.trim();
    const value = trimmed.replace(QUOTED_VALUE, "$2");
    variables[name] =
      trimmed[0] === '"' ? value.replaceAll("\\n", "\n").replaceAll("\\r", "\r") : value;
  }
  return variables;
};

/**
 * The environment the entry's dev server runs with: its manifest `env` over the
 * dotenv files the app loads, listed in the order the app gives them precedence.
 */
export const readProcessEnvironment = (
  entry: CorpusEntry,
  rootDirectory: string,
): ProcessEnvironment | undefined => {
  if (entry.static.envFiles === undefined) return undefined;
  const variables: Record<string, string> = { ...entry.env };
  for (const file of entry.static.envFiles) {
    const parsed = parseDotenv(readFileSync(path.resolve(rootDirectory, file), "utf8"));
    for (const [name, value] of Object.entries(parsed)) variables[name] ??= value;
  }
  return {
    variables,
    clientPrefix: entry.static.envPrefix ?? CLIENT_PREFIXES[entry.framework],
  };
};
