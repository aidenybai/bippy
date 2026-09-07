import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getObjectProperty, listValue, primitiveValue, unknownValue } from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { LibraryValueProvider, StaticValue } from "../types.js";

// Files a server component reads from its own project directory are inputs of
// the render, like an imported JSON module; the same directory backs the dev
// server, so the content is what the runtime read. Reads elsewhere stay unknown.

export const NODE_FS_PACKAGES = ["fs", "node:fs"];

const resolveProjectPath = (
  rootDirectory: string,
  target: StaticValue | undefined,
): string | null => {
  if (target?.kind !== "primitive" || typeof target.value !== "string") return null;
  const resolved = path.resolve(rootDirectory, target.value);
  const relative = path.relative(rootDirectory, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
};

const UTF8_ENCODINGS = new Set(["utf8", "utf-8"]);

const isUtf8Encoding = (options: StaticValue | undefined): boolean => {
  const encoding = options?.kind === "object" ? getObjectProperty(options, "encoding") : options;
  return (
    encoding?.kind === "primitive" &&
    typeof encoding.value === "string" &&
    UTF8_ENCODINGS.has(encoding.value.toLowerCase())
  );
};

const isNamesOnly = (options: StaticValue | undefined): boolean => {
  if (options === undefined || options.kind === "primitive") return true;
  if (options.kind !== "object") return false;
  const withFileTypes = getObjectProperty(options, "withFileTypes");
  return withFileTypes.kind === "primitive" && !withFileTypes.value;
};

const fsFunction = (
  rootDirectory: string,
  name: string,
  read: (target: string, options: StaticValue | undefined) => StaticValue | null,
): StaticValue =>
  nativeFunction(`fs.${name}`, ([target, options]) => {
    const resolved = resolveProjectPath(rootDirectory, target);
    if (resolved === null) return unknownValue(`fs.${name}() outside the project`);
    try {
      return read(resolved, options) ?? unknownValue(`fs.${name}() with unsupported options`);
    } catch (error) {
      return unknownValue(`fs.${name}() threw: ${error instanceof Error ? error.message : error}`);
    }
  });

const getFsExport = (rootDirectory: string, name: string): StaticValue | null => {
  switch (name) {
    case "readdirSync":
      return fsFunction(rootDirectory, name, (target, options) =>
        isNamesOnly(options)
          ? listValue(readdirSync(target).map((entry) => primitiveValue(entry)))
          : null,
      );
    case "readFileSync":
      return fsFunction(rootDirectory, name, (target, options) =>
        isUtf8Encoding(options) ? primitiveValue(readFileSync(target, "utf8")) : null,
      );
    case "existsSync":
      return fsFunction(rootDirectory, name, (target) => primitiveValue(existsSync(target)));
    default:
      return null;
  }
};

export const nodeFsValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (!NODE_FS_PACKAGES.includes(specifier) || project.rootDirectory === null) return null;
  if (importedName === "default" || importedName === "*") return null;
  return getFsExport(project.rootDirectory, importedName);
};
