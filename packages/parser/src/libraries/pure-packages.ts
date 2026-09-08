import { fromNativeValue, pureNativeFunction } from "../evaluate/native-values.js";
import { getPackageNameFromSpecifier } from "../graph/module-resolver.js";
import type { StaticValue } from "../types.js";
import {
  getDefaultExport,
  getInstalledModules,
  type InstalledModules,
} from "./installed-modules.js";

// Packages whose exports are pure functions of their arguments (formatting,
// parsing, class-name joining): the project's own installed copy runs on known
// inputs, so the output is the runtime's, not a model of it. A call with an
// uncertain argument stays opaque, exactly as an unmodeled external call.

const PURE_PACKAGES: ReadonlySet<string> = new Set([
  "class-variance-authority",
  "classnames",
  "clsx",
  "date-fns",
  "gray-matter",
  "node:path",
  "path",
  "tailwind-merge",
]);

export class PurePackages {
  private readonly installed: InstalledModules;

  constructor(rootDirectory: string) {
    this.installed = getInstalledModules(rootDirectory);
  }

  getExport(specifier: string, importedName: string): StaticValue | null {
    const packageName = getPackageNameFromSpecifier(specifier);
    if (packageName === null || !PURE_PACKAGES.has(packageName) || importedName === "*") {
      return null;
    }
    const module = this.installed.load(specifier);
    if (module === null) return null;
    const exported =
      importedName === "default" ? getDefaultExport(module) : Reflect.get(module, importedName);
    if (exported === undefined) return null;
    const name = `${specifier}#${importedName}`;
    return typeof exported === "function"
      ? pureNativeFunction(name, exported, undefined, () => ({
          kind: "external",
          packageName,
          importedName: `${importedName}()`,
          origin: "derived",
        }))
      : fromNativeValue(exported, name);
  }
}
