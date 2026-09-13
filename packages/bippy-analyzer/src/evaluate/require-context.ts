import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { SourceLocation, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { createErrorValue } from "./errors.js";
import { withRelativePrefix } from "./import-glob.js";
import { nativeFunction } from "./stubs.js";
import {
  describeValue,
  listValue,
  primitiveValue,
  setObjectProperty,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

interface RequireContextOptions {
  directory: string;
  isRecursive: boolean;
  requestPattern: RegExp;
}

const DEFAULT_REQUEST_PATTERN = /^\.\/.*$/;
const MAIN_FILES = ["index"];

const readBoolean = (value: StaticValue): boolean | null =>
  value.kind === "primitive" && typeof value.value === "boolean" ? value.value : null;

const readOptions = (args: StaticValue[]): RequireContextOptions | string => {
  const [directory, recursive, requestPattern, mode] = args;
  if (directory?.kind !== "primitive" || typeof directory.value !== "string")
    return `directory ${describeValue(directory)}`;
  const isRecursive = recursive === undefined ? true : readBoolean(recursive);
  if (isRecursive === null) return `useSubdirectories ${describeValue(recursive)}`;
  if (requestPattern !== undefined && requestPattern.kind !== "regexp")
    return `regExp ${describeValue(requestPattern)}`;
  if (mode !== undefined && (mode.kind !== "primitive" || mode.value !== "sync"))
    return `mode ${describeValue(mode)}`;
  return {
    directory: directory.value,
    isRecursive,
    requestPattern:
      requestPattern === undefined
        ? DEFAULT_REQUEST_PATTERN
        : new RegExp(requestPattern.pattern, requestPattern.flags),
  };
};

const listFiles = (directory: string, isRecursive: boolean): string[] | null => {
  if (statSync(directory, { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  const files: string[] = [];
  const visit = (currentDirectory: string): void => {
    for (const name of readdirSync(currentDirectory)) {
      if (name.startsWith(".")) continue;
      const filePath = path.join(currentDirectory, name);
      const stat = statSync(filePath, { throwIfNoEntry: false });
      if (stat?.isDirectory()) {
        if (isRecursive) visit(filePath);
      } else if (stat?.isFile()) {
        files.push(filePath);
      }
    }
  };
  visit(directory);
  return files;
};

const listAlternativeRequests = (request: string, extensions: readonly string[]): string[] => {
  const withoutExtensions = extensions
    .filter((extension) => request.endsWith(extension))
    .map((extension) => request.slice(0, -extension.length));
  return [...withoutExtensions, request].flatMap((candidate) => [
    ...MAIN_FILES.filter((mainFile) => candidate.endsWith(`/${mainFile}`)).flatMap((mainFile) => [
      candidate.slice(0, -mainFile.length),
      candidate.slice(0, -mainFile.length - 1),
    ]),
    candidate,
  ]);
};

export const callRequireContext = (
  interpreter: Interpreter,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const options = readOptions(args);
  if (typeof options === "string") return unknownValue(`require.context with ${options}`, location);
  const importerDirectory = path.dirname(context.module.filePath);
  const contextDirectory = path.resolve(importerDirectory, options.directory);
  const files = listFiles(contextDirectory, options.isRecursive);
  if (files === null)
    return unknownValue(`require.context cannot read "${options.directory}"`, location);
  const specifiersByRequest = new Map<string, string>();
  for (const file of files) {
    const request = `./${path.relative(contextDirectory, file).split(path.sep).join("/")}`;
    const specifier = withRelativePrefix(path.relative(importerDirectory, file));
    for (const alternative of listAlternativeRequests(
      request,
      interpreter.graph.resolver.extensions,
    )) {
      if (options.requestPattern.test(alternative) && !specifiersByRequest.has(alternative))
        specifiersByRequest.set(alternative, specifier);
    }
  }
  const requests = [...specifiersByRequest.keys()].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  const resolveRequest = (
    request: StaticValue | undefined,
    onResolved: (specifier: string) => StaticValue,
  ): StaticValue => {
    if (request?.kind !== "primitive" || typeof request.value !== "string")
      return unknownValue(
        `require.context request ${request === undefined ? "undefined" : describeValue(request)}`,
        location,
      );
    const specifier = specifiersByRequest.get(request.value);
    if (specifier === undefined) {
      const message = `Cannot find module '${request.value}'`;
      const error = createErrorValue("Error", [primitiveValue(message)], location);
      setObjectProperty(error, "code", primitiveValue("MODULE_NOT_FOUND"));
      return thrownValue(message, error, location);
    }
    return onResolved(specifier);
  };
  const ownProperties: Record<string, StaticValue> = {
    keys: nativeFunction("webpackContextKeys", () =>
      listValue(requests.map((request) => primitiveValue(request))),
    ),
    resolve: nativeFunction("webpackContextResolve", ([request]) =>
      resolveRequest(request, (specifier) =>
        unknownPrimitiveValue("string", `module id of ${specifier}`),
      ),
    ),
    id: unknownPrimitiveValue("string", "context module id"),
  };
  return {
    kind: "native-function",
    name: "webpackContext",
    call: ([request]) =>
      resolveRequest(request, (specifier) =>
        interpreter.importModule(specifier, context, location, true),
      ),
    getOwnProperty: (key) => ownProperties[key],
  };
};
