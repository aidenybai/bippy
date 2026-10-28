import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ConfigError } from "../../src/core/config-error";
import {
  checkSpec,
  createComponentModuleResolver,
  findSpecFiles,
  formatSpecCheck,
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

  it("prints a broken property the way TLC does", () => {
    const specCheck = checkFixtureSpec("src/UploadChecks.tla");
    expect(specCheck && formatSpecCheck(specCheck, ROOT_DIRECTORY)).toBe(
      [
        "Checking src/UploadChecks.tla with src/UploadChecks.cfg",
        "Error: Temporal property DoneIsFinal was violated.",
        "Error: The behavior up to this point is:",
        "State 1: <Initial predicate>",
        '/\\ status = "idle"',
        "/\\ error = Null",
        "",
        "State 2: <onClick_t2>",
        '/\\ status = "done"',
        "/\\ error = Null",
        "",
        "State 3: <onClick_t1>",
        '/\\ status = "idle"',
        "/\\ error = Null",
        "",
        "10 states generated, 5 distinct states found, 0 states left on queue.",
        "The depth of the complete state graph search is 2.",
      ].join("\n"),
    );
  });

  it("resolves a shared component name to the one beside the spec", () => {
    expect(checkFixtureSpec("src/a/ToggleChecks.tla")?.result.status).toBe("liveness-violation");
  });

  it("resolves a name qualified by its file", () => {
    expect(checkFixtureSpec("src/OneWayChecks.tla")?.result.status).toBe("success");
  });

  it("rejects a shared component name with no component beside the spec", () => {
    expect(() => checkFixtureSpec("src/AmbiguousChecks.tla")).toThrow(ConfigError);
  });

  it("skips a spec that uses no component", () => {
    expect(checkFixtureSpec("src/Standalone.tla")).toBeNull();
  });
});
