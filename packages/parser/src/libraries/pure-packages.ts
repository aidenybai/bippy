import { createRequire } from "node:module";
import path from "node:path";
import { fromNativeValue, pureNativeFunction } from "../evaluate/native-values.js";
import { getPackageNameFromSpecifier } from "../graph/module-resolver.js";
import type { StaticValue } from "../types.js";

// Packages whose exports are pure functions of their arguments (formatting,
// parsing, class-name joining): the project's own installed copy runs on known
// inputs, so the output is the runtime's, not a model of it. A call with an
// uncertain argument stays opaque, exactly as an unmodeled external call.

const PURE_PACKAGES: ReadonlySet<string> = new Set([
  "classnames",
  "clsx",
  "date-fns",
  "gray-matter",
  "node:path",
  "path",
  "tailwind-merge",
]);

const isModuleNamespace = (module: object): boolean =>
  Object.prototype.toString.call(module) === "[object Module]";

const getDefaultExport = (module: object): unknown =>
  isModuleNamespace(module) || Reflect.get(module, "__esModule") === true
    ? Reflect.get(module, "default")
    : module;

export class PurePackages {
  private readonly requireFromRoot: NodeJS.Require;
  private readonly modules = new Map<string, object | null>();

  constructor(rootDirectory: string) {
    this.requireFromRoot = createRequire(path.join(rootDirectory, "package.json"));
  }

  getExport(specifier: string, importedName: string): StaticValue | null {
    const packageName = getPackageNameFromSpecifier(specifier);
    if (packageName === null || !PURE_PACKAGES.has(packageName) || importedName === "*") {
      return null;
    }
    const module = this.load(specifier);
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
          derived: true,
        }))
      : fromNativeValue(exported, name);
  }

  private load(specifier: string): object | null {
    const cached = this.modules.get(specifier);
    if (cached !== undefined) return cached;
    let module: object | null = null;
    try {
      const loaded: unknown = this.requireFromRoot(specifier);
      if ((typeof loaded === "object" && loaded !== null) || typeof loaded === "function") {
        module = loaded;
      }
    } catch {
      module = null;
    }
    this.modules.set(specifier, module);
    return module;
  }
}
