import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ConfigError } from "../../src/core/config-error";
import {
  checkSpec,
  createComponentModuleResolver,
  findSpecFiles,
  formatSpecResult,
} from "../../src/cli/tla-specs";
import { analyzeFixture, getFixtureConfig } from "./helpers";

const ROOT_DIRECTORY = dirname(getFixtureConfig("tla-specs"));

describe("TLA+ specs", () => {
  const resolveComponentModule = createComponentModuleResolver(
    analyzeFixture("tla-specs").components,
    ROOT_DIRECTORY,
  );
  const checkFixtureSpec = (path: string) =>
    checkSpec(join(ROOT_DIRECTORY, path), resolveComponentModule);

  it("finds every .tla file in the project", () => {
    expect(
      findSpecFiles(ROOT_DIRECTORY)
        .map((file) => relative(ROOT_DIRECTORY, file))
        .sort(),
    ).toEqual([
      "src/AmbiguousChecks.tla",
      "src/OneWayChecks.tla",
      "src/Standalone.tla",
      "src/UploadChecks.tla",
      "src/a/ToggleChecks.tla",
    ]);
  });

  it("checks each property and traces a broken one back to its clicks", () => {
    const result = checkFixtureSpec("src/UploadChecks.tla");
    expect(result && formatSpecResult(result, ROOT_DIRECTORY)).toBe(
      [
        "src/UploadChecks.tla",
        "  holds   NoErrorWhileUploading",
        "  holds   ErrorOnlyWhenFailed",
        "  broken  DoneIsFinal",
        '    1. first render: status = "idle", error = Null',
        '    2. "Upload" · src/upload.tsx L7: status = "done"',
        '    3. "Upload another" · src/upload.tsx L19: status = "idle"',
      ].join("\n"),
    );
  });

  it("resolves a shared component name to the one beside the spec", () => {
    expect(
      checkFixtureSpec("src/a/ToggleChecks.tla")?.properties.map((property) => property.status),
    ).toEqual(["liveness-violation"]);
  });

  it("resolves a name qualified by its file", () => {
    expect(
      checkFixtureSpec("src/OneWayChecks.tla")?.properties.map((property) => property.status),
    ).toEqual(["success"]);
  });

  it("rejects a shared component name with no component beside the spec", () => {
    expect(() => checkFixtureSpec("src/AmbiguousChecks.tla")).toThrow(ConfigError);
  });

  it("skips a spec that uses no component", () => {
    expect(checkFixtureSpec("src/Standalone.tla")).toBeNull();
  });
});
