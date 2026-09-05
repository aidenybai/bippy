import { resolve } from "node:path";
import * as main from "bippy";
import * as source from "bippy/source";
import { describe, expect, it } from "vite-plus/test";
import {
  getExpectedExports,
  getTestDefinitions,
  readApiCoverage,
  repositoryDirectory,
} from "../scripts/test-inventory.js";

const coverage = readApiCoverage();

describe("public API coverage inventory", () => {
  it.each([
    { entry: "bippy", module: main },
    { entry: "bippy/source", module: source },
  ])("accounts for every runtime export of $entry exactly once", ({ entry, module }) => {
    const exports = getExpectedExports(entry);
    expect(exports).toEqual(Object.keys(module).sort());
    expect(new Set(exports).size).toBe(exports.length);
  });

  it("references executable test files rather than nonexistent coverage", () => {
    for (const group of coverage) {
      expect(["bippy", "bippy/source"]).toContain(group.entry);
      expect(group.tests.length).toBeGreaterThan(0);
      for (const path of group.tests) {
        expect(
          getTestDefinitions(resolve(repositoryDirectory, path)).some(
            (definition) => definition.kind !== "describe",
          ),
          path,
        ).toBe(true);
      }
    }
  });

  it("keeps aliases and shared errors identical across entries", () => {
    expect(main.getFiberFromHostInstance).toBe(main.getFiber);
    for (const errorName of [
      "BippyError",
      "BippyHookInspectionError",
      "BippyHookRenderError",
      "BippySourceMapError",
      "BippyUnsupportedHookError",
    ]) {
      expect(Reflect.get(main, errorName)).toBe(Reflect.get(source, errorName));
    }
  });
});
