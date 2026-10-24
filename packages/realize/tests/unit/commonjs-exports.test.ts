import { describe, expect, it } from "vite-plus/test";
import { wrapCommonJs } from "../conformance/verifier/harness/transforms";

const importSource = (source: string): Promise<Record<string, unknown>> =>
  import(`data:text/javascript,${encodeURIComponent(source)}`);

describe("commonjs app modules", () => {
  it("exports each name a module assigns onto exports", async () => {
    const source = wrapCommonJs('exports.siteConfig = { version: "19" };\nexports.isRTL = false;');
    const namespace = await importSource(source ?? "");
    expect(namespace.siteConfig).toEqual({ version: "19" });
    expect(namespace.isRTL).toBe(false);
    expect(namespace.default).toEqual({ siteConfig: { version: "19" }, isRTL: false });
  });

  it("exports names assigned onto module.exports, including reserved words", async () => {
    const namespace = await importSource(
      wrapCommonJs("module.exports.new = 1;\nmodule.exports.default = 2;") ?? "",
    );
    expect(namespace.new).toBe(1);
    expect(namespace.default).toEqual({ new: 1, default: 2 });
  });

  it("leaves ES modules alone", () => {
    expect(wrapCommonJs("export const exports = 1;")).toBeNull();
  });
});
