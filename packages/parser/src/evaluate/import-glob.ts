import path from "node:path";
import { globSync } from "tinyglobby";
import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { nativeFunction } from "./stubs.js";
import { isModuleRecord } from "../graph/module-graph.js";
import { resolvedPromiseValue } from "./promises.js";
import { describeValue, getObjectProperty, objectValue, unknownValue } from "./values.js";

interface ImportGlobOptions {
  isEager: boolean;
  importedName: string | null;
  query: string;
  base: string | null;
}

interface ImportGlobFile {
  key: string;
  specifier: string;
}

interface ImportGlobOptionError {
  error: string;
}

const GLOB_MAGIC = /[*?[{]/;
const RELATIVE_PREFIX = /^\.\.?\//;

const readOption = (
  options: StaticObjectValue,
  name: string,
): string | boolean | undefined | ImportGlobOptionError => {
  const value = getObjectProperty(options, name);
  if (
    value.kind === "primitive" &&
    (typeof value.value === "string" ||
      typeof value.value === "boolean" ||
      value.value === undefined)
  ) {
    return value.value;
  }
  return { error: `option ${name} ${describeValue(value)}` };
};

const readImportGlobOptions = (options: StaticValue | undefined): ImportGlobOptions | string => {
  if (options === undefined) return { isEager: false, importedName: null, query: "", base: null };
  if (options.kind !== "object") return `options ${describeValue(options)}`;
  const eager = readOption(options, "eager");
  const importedName = readOption(options, "import");
  const query = readOption(options, "query");
  const base = readOption(options, "base");
  const exhaustive = readOption(options, "exhaustive");
  for (const option of [eager, importedName, query, base, exhaustive]) {
    if (typeof option === "object") return option.error;
  }
  if (exhaustive === true) return "option exhaustive is not modeled";
  const queryText = typeof query === "string" ? query : "";
  return {
    isEager: eager === true,
    importedName: typeof importedName === "string" && importedName !== "*" ? importedName : null,
    query: queryText === "" || queryText.startsWith("?") ? queryText : `?${queryText}`,
    base: typeof base === "string" ? base : null,
  };
};

const readPatterns = (patterns: StaticValue | undefined): string[] | string => {
  if (patterns === undefined) return "no pattern";
  if (patterns.kind === "primitive" && typeof patterns.value === "string") return [patterns.value];
  if (patterns.kind === "list") {
    const texts: string[] = [];
    for (const item of patterns.items) {
      if (item.kind !== "primitive" || typeof item.value !== "string")
        return `pattern ${describeValue(item)}`;
      texts.push(item.value);
    }
    return texts;
  }
  return `pattern ${describeValue(patterns)}`;
};

const toAbsoluteGlob = (
  pattern: string,
  importerDirectory: string,
  rootDirectory: string | null,
): string | null => {
  if (pattern.startsWith("/")) {
    return rootDirectory === null ? null : path.join(rootDirectory, pattern.slice(1));
  }
  if (RELATIVE_PREFIX.test(pattern)) return path.join(importerDirectory, pattern);
  return null;
};

const globAbsolute = (absolutePattern: string): string[] => {
  const magicIndex = absolutePattern.search(GLOB_MAGIC);
  const staticPart = magicIndex === -1 ? absolutePattern : absolutePattern.slice(0, magicIndex);
  const cwd = staticPart.endsWith("/") ? staticPart : path.dirname(staticPart);
  return globSync(path.relative(cwd, absolutePattern), {
    cwd,
    absolute: true,
    expandDirectories: false,
    ignore: ["**/node_modules/**"],
  });
};

const withRelativePrefix = (relativePath: string): string =>
  RELATIVE_PREFIX.test(relativePath) ? relativePath : `./${relativePath}`;

const listImportGlobFiles = (
  patterns: string[],
  options: ImportGlobOptions,
  importerPath: string,
  rootDirectory: string | null,
): ImportGlobFile[] | string => {
  const importerDirectory = path.dirname(importerPath);
  const included = new Set<string>();
  const excluded = new Set<string>();
  let hasRelativePattern = false;
  for (const pattern of patterns) {
    const isNegated = pattern.startsWith("!");
    const bare = isNegated ? pattern.slice(1) : pattern;
    const absolutePattern = toAbsoluteGlob(bare, importerDirectory, rootDirectory);
    if (absolutePattern === null) return `pattern "${pattern}" is not relative or root-absolute`;
    if (!isNegated && RELATIVE_PREFIX.test(bare)) hasRelativePattern = true;
    for (const file of globAbsolute(absolutePattern)) (isNegated ? excluded : included).add(file);
  }
  const baseDirectory =
    options.base === null
      ? null
      : options.base.startsWith("/")
        ? rootDirectory === null
          ? null
          : path.join(rootDirectory, options.base)
        : path.join(importerDirectory, options.base);
  if (options.base !== null && baseDirectory === null) return "option base needs a project root";
  const files = [...included].filter((file) => !excluded.has(file) && file !== importerPath).sort();
  return files.map((file) => {
    const specifier = `${withRelativePrefix(path.relative(importerDirectory, file))}${options.query}`;
    if (baseDirectory !== null) {
      return { key: withRelativePrefix(path.relative(baseDirectory, file)), specifier };
    }
    if (hasRelativePattern) {
      return { key: withRelativePrefix(path.relative(importerDirectory, file)), specifier };
    }
    return { key: `/${path.relative(rootDirectory ?? importerDirectory, file)}`, specifier };
  });
};

export const callImportMetaGlob = (
  interpreter: Interpreter,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const patterns = readPatterns(args[0]);
  if (typeof patterns === "string")
    return unknownValue(`import.meta.glob with ${patterns}`, location);
  const options = readImportGlobOptions(args[1]);
  if (typeof options === "string")
    return unknownValue(`import.meta.glob with ${options}`, location);
  const files = listImportGlobFiles(
    patterns,
    options,
    context.module.filePath,
    interpreter.graph.resolver.rootDirectory,
  );
  if (typeof files === "string") return unknownValue(`import.meta.glob with ${files}`, location);
  for (const file of files) {
    const target = interpreter.graph.resolveImportedModule(file.specifier, context.module);
    if (isModuleRecord(target) || target.kind !== "internal" || target.filePath === null) continue;
    return unknownValue(
      `import.meta.glob matched "${file.specifier}": ${interpreter.graph.describeUnsupportedModule(target.filePath)}`,
      location,
    );
  }
  const importFile = (file: ImportGlobFile): StaticValue => {
    const namespace = interpreter.importModule(file.specifier, context, location, false);
    return options.importedName === null
      ? namespace
      : interpreter.getProperty(namespace, options.importedName, context, location);
  };
  return objectValue(
    files.map((file) => ({
      kind: "property",
      key: file.key,
      value: options.isEager
        ? importFile(file)
        : nativeFunction("", () => resolvedPromiseValue(importFile(file))),
    })),
  );
};
