import { readdirSync } from "node:fs";
import path from "node:path";
import { nativeFunction } from "./stubs.js";
import type { SourceLocation, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue } from "./errors.js";
import type { Interpreter } from "./interpreter.js";
import { describeValue, listValue, primitiveValue, thrownValue, unknownValue } from "./values.js";

/** webpack's `require.context` default filter: every module under the directory. */
const DEFAULT_FILTER = /^\.\/.*$/;

/** The modes that resolve a key to the module's exports synchronously, as `require` does. */
const SYNC_MODES = new Set(["sync", "eager"]);

interface RequireContextFile {
  key: string;
  specifier: string;
}

const readDirectory = (directory: StaticValue | undefined): string | null =>
  directory?.kind === "primitive" && typeof directory.value === "string" ? directory.value : null;

const readRecursive = (recursive: StaticValue | undefined): boolean | null => {
  if (recursive === undefined) return true;
  return recursive.kind === "primitive" && typeof recursive.value === "boolean"
    ? recursive.value
    : null;
};

const readFilter = (filter: StaticValue | undefined): RegExp | null => {
  if (filter === undefined) return DEFAULT_FILTER;
  return filter.kind === "regexp" ? new RegExp(filter.pattern, filter.flags) : null;
};

const readMode = (mode: StaticValue | undefined): string | null => {
  if (mode === undefined) return "sync";
  return mode.kind === "primitive" && typeof mode.value === "string" ? mode.value : null;
};

const walkFiles = (directory: string, recursive: boolean): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) files.push(...walkFiles(entryPath, true));
      continue;
    }
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
};

const listContextFiles = (
  contextDirectory: string,
  recursive: boolean,
  filter: RegExp,
  importerDirectory: string,
): RequireContextFile[] =>
  walkFiles(contextDirectory, recursive)
    .sort()
    .map((file) => ({
      key: `./${path.relative(contextDirectory, file)}`,
      specifier: `./${path.relative(importerDirectory, file)}`,
    }))
    .filter((file) => filter.test(file.key));

/**
 * `require.context(directory, recursive, filter, mode)` as webpack and Metro
 * implement it: a `require`-like function over the modules under `directory`
 * (resolved against the importing module) whose `./`-relative path matches
 * `filter`, with `keys()` listing those paths.
 */
export const callRequireContext = (
  interpreter: Interpreter,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const directory = readDirectory(args[0]);
  if (directory === null)
    return unknownValue(
      `require.context with directory ${args[0] === undefined ? "missing" : describeValue(args[0])}`,
      location,
    );
  const recursive = readRecursive(args[1]);
  if (recursive === null)
    return unknownValue(`require.context with recursive ${describeValue(args[1])}`, location);
  const filter = readFilter(args[2]);
  if (filter === null)
    return unknownValue(`require.context with filter ${describeValue(args[2])}`, location);
  const mode = readMode(args[3]);
  if (mode === null || !SYNC_MODES.has(mode))
    return unknownValue(`require.context in mode ${mode ?? describeValue(args[3])}`, location);
  const importerDirectory = path.dirname(context.module.filePath);
  const contextDirectory = path.resolve(importerDirectory, directory);
  const files = listContextFiles(contextDirectory, recursive, filter, importerDirectory);
  const keys = files.map((file) => file.key);
  const requireKey = (key: StaticValue | undefined): StaticValue => {
    if (key?.kind !== "primitive" || typeof key.value !== "string")
      return unknownValue(
        `require.context key ${key === undefined ? "missing" : describeValue(key)}`,
        location,
      );
    const file = files.find((candidate) => candidate.key === key.value);
    if (file === undefined) {
      const message = `Cannot find module '${key.value}'`;
      return thrownValue(message, createErrorValue("Error", [primitiveValue(message)], location));
    }
    return interpreter.importModule(file.specifier, context, location, true);
  };
  return {
    kind: "native-function",
    name: "webpackContext",
    call: ([key]) => requireKey(key),
    getOwnProperty: (property) => {
      if (property === "keys")
        return nativeFunction("keys", () => listValue(keys.map((key) => primitiveValue(key))));
      if (property === "resolve") return nativeFunction("resolve", ([key]) => requireKey(key));
      return undefined;
    },
  };
};
