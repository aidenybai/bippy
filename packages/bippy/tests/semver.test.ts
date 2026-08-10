import { describe, expect, it } from "vite-plus/test";
import { compareSemver } from "../src/react-internals/semver.js";

describe("compareSemver", () => {
  it("orders the SemVer precedence example", () => {
    const versions = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let versionIndex = 1; versionIndex < versions.length; versionIndex++) {
      expect(compareSemver(versions[versionIndex - 1], versions[versionIndex])).toBe(-1);
      expect(compareSemver(versions[versionIndex], versions[versionIndex - 1])).toBe(1);
    }
  });

  it("ignores build metadata", () => {
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareSemver("1.0.0-alpha+build", "1.0.0-alpha+other")).toBe(0);
  });

  it("compares numeric identifiers without precision loss", () => {
    expect(compareSemver("999999999999999999999.0.0", "1000000000000000000000.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-999999999999999999999", "1.0.0-1000000000000000000000")).toBe(-1);
  });

  it.each([
    "0.0.0",
    "1.0.0-0",
    "1.0.0-x.7.z.92",
    "1.0.0+20130313144700",
    "1.0.0-beta+exp.sha.5114f85",
    "1.0.0+001",
  ])("accepts valid version %s", (version) => {
    expect(compareSemver(version, version)).toBe(0);
  });

  it.each([
    "1",
    "1.0",
    "01.0.0",
    "1.01.0",
    "1.0.01",
    "1.0.0-01",
    "1.0.0-alpha..beta",
    "1.0.0-alpha_1",
    "1.0.0-",
    "1.0.0+",
    "1.0.0+meta..value",
    "1.0.0 ",
    "v1.0.0",
  ])("rejects invalid version %s", (version) => {
    expect(compareSemver(version, "1.0.0")).toBeNull();
  });
});
