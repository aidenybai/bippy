import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { isVersionAtLeast, readInstalledVersion } from "../src/graph/installed-version.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("readInstalledVersion", () => {
  it("reads the version of a package resolvable from the project root", () => {
    const version = readInstalledVersion(join(FIXTURES, "nested-suspense-opaque"), "ui-kit");
    expect(version).toBe("0.0.0");
  });

  it("returns null when the package is not installed", () => {
    expect(
      readInstalledVersion(join(FIXTURES, "nested-suspense-opaque"), "missing-pkg"),
    ).toBeNull();
  });
});

describe("isVersionAtLeast", () => {
  it("compares numeric segments", () => {
    expect(isVersionAtLeast("15.3.0", "15.3.0")).toBe(true);
    expect(isVersionAtLeast("15.10.1", "15.3.0")).toBe(true);
    expect(isVersionAtLeast("14.2.5", "15.3.0")).toBe(false);
    expect(isVersionAtLeast("16", "15.3.0")).toBe(true);
  });

  it("ignores prerelease suffixes", () => {
    expect(isVersionAtLeast("15.3.0-canary.12", "15.3.0")).toBe(true);
    expect(isVersionAtLeast("15.2.9-canary.1", "15.3.0")).toBe(false);
  });
});
