import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { getTestDefinitions, getTestTitles } from "../scripts/test-inventory.js";

const withTestSource = (source: string, check: (path: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-test-inventory-"));
  const path = join(directory, "fixture.ts");
  writeFileSync(path, source);
  try {
    check(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

it("reads multiline titles without counting comments or source strings", () => {
  withTestSource(
    `
    // it("comment", () => {});
    const source = 'it("string", () => {})';
    describe("suite", () => {
      it(
        "a real test",
        () => {},
      );
      test("escaped \\"quote\\"", () => {});
      test.beforeEach(() => {});
      test.use({ browserName: "chromium" });
    });
  `,
    (path) => {
      expect(getTestTitles(path)).toEqual(["a real test", 'escaped "quote"']);
      expect(getTestDefinitions(path, true)).toHaveLength(3);
    },
  );
});

it("tracks modifiers without treating parameterized tables as test titles", () => {
  withTestSource(
    'it.each(`table`)("parameterized", () => {}); describe.skip("hidden suite", () => {}); it.skipIf(true)("conditional", () => {}); test.only("exclusive", () => {});',
    (path) => {
      expect(getTestDefinitions(path)).toEqual([
        { kind: "it", title: "parameterized", modifiers: ["each"] },
        { kind: "describe", title: "hidden suite", modifiers: ["skip"] },
        { kind: "it", title: "conditional", modifiers: ["skipIf"] },
        { kind: "test", title: "exclusive", modifiers: ["only"] },
      ]);
    },
  );
});

it("rejects dynamic upstream titles instead of silently dropping cases", () => {
  withTestSource("it(title, () => {});", (path) => {
    expect(() => getTestDefinitions(path, true)).toThrow("dynamic test definition");
  });
});
