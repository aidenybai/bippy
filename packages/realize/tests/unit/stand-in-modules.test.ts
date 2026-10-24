import { describe, expect, it } from "vite-plus/test";
import { createStandInPlugin } from "../conformance/verifier/harness/stand-ins";

const STAND_IN_MODULE_PREFIX = "\0bippy-verify-stand-in:";

const loadStandIn = (specifier: string, names: string[]): string => {
  const plugin = createStandInPlugin(new Set(), new Map([[specifier, new Set(names)]]));
  const load = plugin.load;
  if (typeof load !== "function") throw new Error("stand-in plugin has no load hook");
  const source = Reflect.apply(load, plugin, [`${STAND_IN_MODULE_PREFIX}${specifier}`]);
  if (typeof source !== "string") throw new Error("stand-in module did not load");
  return source;
};

describe("stand-in modules", () => {
  it("exports each name the app imports from a package whose runtime is generated", () => {
    const source = loadStandIn("@umijs/max", ["history", "useModel"]);
    expect(source).toContain("export const history = STAND_IN;");
    expect(source).toContain("export const useModel = STAND_IN;");
    expect(source).toContain("export default STAND_IN;");
  });

  it("skips import names that are not identifiers", () => {
    const source = loadStandIn("@umijs/max", ["history", "appConfig: {", "${items.join('"]);
    expect(source).toContain("export const history = STAND_IN;");
    expect(source).not.toContain("appConfig");
    expect(source).not.toContain("items.join");
  });
});
