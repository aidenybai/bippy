import { getInstalledModules } from "../libraries/installed-modules.js";
import type { SourceTransform, TransformedSource } from "../types.js";

const YAML_LOADER_PACKAGE = "yaml-loader";
const YAML_EXTENSIONS = [".yaml", ".yml"];

/** The subset of webpack's loader context `yaml-loader` reads. */
interface YamlLoaderContext {
  getOptions: () => Record<string, never>;
  resourceQuery: string;
  emitWarning: (warning: unknown) => void;
}

/**
 * `yaml-loader` runs synchronously and returns the module source
 * (`export default <document>;`), so the app's installed copy produces the
 * exact module webpack links for a `.yaml` import.
 */
export const createYamlSourceTransforms = (rootDirectory: string): SourceTransform[] => {
  const loader = getInstalledModules(rootDirectory).load(YAML_LOADER_PACKAGE);
  if (typeof loader !== "function") return [];
  const transform = (_filePath: string, sourceText: string): TransformedSource | null => {
    const context: YamlLoaderContext = {
      getOptions: () => ({}),
      resourceQuery: "",
      emitWarning: () => {},
    };
    try {
      const code: unknown = Reflect.apply(loader, context, [sourceText]);
      return typeof code === "string" ? { sourceText: code, lang: "js" } : null;
    } catch {
      return null;
    }
  };
  return YAML_EXTENSIONS.map((extension) => ({ extension, transform }));
};
