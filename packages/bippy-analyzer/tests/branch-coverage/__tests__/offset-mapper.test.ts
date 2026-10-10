import { describe, expect, it } from "vite-plus/test";
import { createOffsetMapper } from "../report.js";

const mapperFor = (source: string, sources: string[], mappings: string) => {
  const mapJson = JSON.stringify({ version: 3, sources, names: [], mappings });
  return createOffsetMapper("/virtual/bundle.js", source, "/virtual", mapJson);
};

describe("createOffsetMapper third-party fallback guard", () => {
  // One generated line `if(a){dep()}` whose ONLY mapping (column 6, the `dep`
  // call) points into node_modules. The `if` decision sits at column 0, before
  // that mapping. The nearest-token fallback must NOT relabel this first-party
  // byte as the node_modules token — that would let the worklist's third-party
  // filter silently drop a real first-party gap.
  const source = "if(a){dep()}";

  it("does not relabel a first-party byte as the line's inlined node_modules token", () => {
    // "MAAA": generated column +6, source 0, original line +0, original col +0.
    const mapper = mapperFor(source, ["../node_modules/dep/x.js"], "MAAA");
    expect(mapper).not.toBeNull();
    // The exact node_modules token still resolves (it's a true mapping).
    expect(mapper!(6)?.file).toContain("node_modules");
    // The first-party `if` byte must resolve to nothing, so the caller keeps it
    // first-party via the served line rather than dropping it.
    expect(mapper!(0)).toBeNull();
  });

  it("still recovers a first-party line via the nearest token", () => {
    // Same layout but the lone mapping is first-party: the col-0 byte should
    // resolve to that first-party source line, not be discarded.
    const mapper = mapperFor(source, ["src/app.ts"], "MAAA");
    expect(mapper!(0)?.file).toBe("src/app.ts");
  });
});
