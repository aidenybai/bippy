import { fromNativeValue, pureNativeFunction } from "../evaluate/native-values.js";
import { memoizeScalarOperation } from "../evaluate/scalar-memo.js";
import { getPackageNameFromSpecifier } from "../graph/module-resolver.js";
import type { StaticExternalValue, StaticValue } from "../types.js";
import {
  getDefaultExport,
  getInstalledModules,
  type InstalledModules,
} from "./installed-modules.js";

// Packages whose exports are pure functions of their arguments (formatting,
// parsing, class-name joining): the project's own installed copy runs on known
// inputs, so the output is the runtime's, not a model of it. A call with an
// uncertain argument stays opaque, exactly as an unmodeled external call.
// Exports that read the clock, randomness or module state are excluded.

const PURE_PACKAGES: ReadonlySet<string> = new Set([
  "@emotion/hash",
  "class-variance-authority",
  "classnames",
  "clsx",
  "date-fns",
  "escape-string-regexp",
  "gray-matter",
  "hasown",
  "lodash",
  "lodash-es",
  "node:path",
  "node:url",
  "object.entries",
  "path",
  "path-to-regexp",
  "tailwind-merge",
  "url",
]);

const liftExport = (
  specifier: string,
  exportedName: string,
  exported: unknown,
): StaticValue | null => {
  const packageName = getPackageNameFromSpecifier(specifier);
  if (packageName === null || exported === undefined) return null;
  const name = `${specifier}#${exportedName}`;
  if (typeof exported !== "function") return fromNativeValue(exported, name, null);
  return pureNativeFunction(name, exported, undefined, null, (args) => {
    const derive = (): StaticExternalValue => ({
      kind: "external",
      packageName,
      importedName: `${exportedName}()`,
      origin: "derived",
    });
    return memoizeScalarOperation(exported, args, derive) ?? derive();
  });
};

const IMPURE_LODASH_EXPORTS: ReadonlySet<string> = new Set([
  "debounce",
  "defer",
  "delay",
  "memoize",
  "mixin",
  "now",
  "once",
  "random",
  "runInContext",
  "sample",
  "sampleSize",
  "shuffle",
  "throttle",
  "uniqueId",
]);

const IMPURE_EXPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["lodash", IMPURE_LODASH_EXPORTS],
  ["lodash-es", IMPURE_LODASH_EXPORTS],
]);

/** `lodash.mergewith`-style per-method packages: the same helper as `lodash/mergeWith`, published lowercase. */
const LODASH_METHOD_PACKAGE_PREFIX = "lodash.";

const IMPURE_LODASH_METHOD_PACKAGES: ReadonlySet<string> = new Set(
  [...IMPURE_LODASH_EXPORTS].map(
    (helperName) => `${LODASH_METHOD_PACKAGE_PREFIX}${helperName.toLowerCase()}`,
  ),
);

const isPureLodashMethodPackage = (packageName: string): boolean =>
  packageName.startsWith(LODASH_METHOD_PACKAGE_PREFIX) &&
  !IMPURE_LODASH_METHOD_PACKAGES.has(packageName);

export const isPurePackage = (packageName: string): boolean =>
  PURE_PACKAGES.has(packageName) || isPureLodashMethodPackage(packageName);

/** The helper a `lodash/isNil`-style deep import names; the imported binding otherwise. */
const getExportName = (specifier: string, packageName: string, importedName: string): string =>
  importedName === "default" && specifier.length > packageName.length
    ? specifier.slice(packageName.length + 1)
    : importedName;

export class PurePackages {
  private readonly installed: InstalledModules;

  constructor(rootDirectory: string) {
    this.installed = getInstalledModules(rootDirectory);
  }

  /** `filePath` is the installed file the import resolved to, so a nested copy (a dependency's own `path-to-regexp`) is the one that runs. */
  getExport(specifier: string, importedName: string, filePath: string | null): StaticValue | null {
    const packageName = getPackageNameFromSpecifier(specifier);
    if (packageName === null || importedName === "*") return null;
    if (IMPURE_EXPORTS.get(packageName)?.has(getExportName(specifier, packageName, importedName))) {
      return null;
    }
    const module = this.loadPure(specifier, filePath);
    if (module === null) return null;
    const exported =
      importedName === "default" ? getDefaultExport(module) : Reflect.get(module, importedName);
    return liftExport(specifier, importedName, exported);
  }

  /** `require(specifier)`: the installed module's `module.exports`, whatever shape it has. */
  getRequired(specifier: string, filePath: string | null): StaticValue | null {
    const module = this.loadPure(specifier, filePath);
    return module === null ? null : liftExport(specifier, "module.exports", module);
  }

  private loadPure(specifier: string, filePath: string | null): object | null {
    const packageName = getPackageNameFromSpecifier(specifier);
    if (packageName === null || !isPurePackage(packageName)) return null;
    return filePath === null
      ? this.installed.load(specifier)
      : this.installed.loadBeside(specifier, filePath);
  }
}
