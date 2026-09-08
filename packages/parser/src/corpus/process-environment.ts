import { readFileSync } from "node:fs";
import path from "node:path";
import type { FrameworkKind } from "../frameworks/framework-profile.js";
import { readDeclaredDependencies } from "../graph/project-context.js";
import type { ProcessEnvironment } from "../types.js";
import type { CorpusEntry } from "./manifest.js";

const NEXT_CLIENT_PREFIX = "NEXT_PUBLIC_";

/** The variables a client-only bundler inlines, by the bundler the app declares: CRA's `react-scripts`, otherwise Vite. */
const SPA_CLIENT_PREFIXES: ReadonlyMap<string, string> = new Map([["react-scripts", "REACT_APP_"]]);

const VITE_CLIENT_PREFIX = "VITE_";

const readClientPrefix = (framework: FrameworkKind, rootDirectory: string): string => {
  if (framework === "next-app" || framework === "next-pages") return NEXT_CLIENT_PREFIX;
  const declared = readDeclaredDependencies(path.join(rootDirectory, "package.json"));
  for (const [bundler, prefix] of SPA_CLIENT_PREFIXES) {
    if (declared?.has(bundler)) return prefix;
  }
  return VITE_CLIENT_PREFIX;
};

const DOTENV_LINE = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/;

const unquote = (rawValue: string): string => {
  const quote = rawValue[0];
  if ((quote === '"' || quote === "'" || quote === "`") && rawValue.indexOf(quote, 1) > 0) {
    const value = rawValue.slice(1, rawValue.indexOf(quote, 1));
    return quote === '"' ? value.replaceAll("\\n", "\n").replaceAll("\\r", "\r") : value;
  }
  return rawValue.replace(/#.*$/, "").trim();
};

/** Single-line `dotenv` syntax: `KEY=value`, quoted values, `#` comments; a variable set first wins, as in `dotenv`. */
const parseDotenv = (source: string, variables: Record<string, string>): void => {
  for (const line of source.split(/\r?\n/)) {
    const match = DOTENV_LINE.exec(line.trim());
    if (match === null) continue;
    const [, name, rawValue] = match;
    variables[name] ??= unquote(rawValue);
  }
};

/** The environment the entry's dev server runs with: its manifest `env` over the dotenv files the app loads. */
export const readProcessEnvironment = (
  entry: CorpusEntry,
  rootDirectory: string,
): ProcessEnvironment | undefined => {
  if (entry.static.envFiles === undefined) return undefined;
  const variables: Record<string, string> = { ...entry.env };
  for (const file of entry.static.envFiles) {
    parseDotenv(readFileSync(path.resolve(rootDirectory, file), "utf8"), variables);
  }
  return { variables, clientPrefix: readClientPrefix(entry.framework, rootDirectory) };
};
