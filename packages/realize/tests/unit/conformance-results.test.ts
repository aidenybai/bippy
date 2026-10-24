import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { CollectSummary } from "../conformance/runner/collect";
import type { RepoConfig } from "../conformance/runner/repos";
import { formatTable, hasFailure, readRepoResult } from "../conformance/runner/results";

const repo = (id: string): RepoConfig => ({
  id,
  repository: `https://github.com/example/${id}`,
  revision: "0".repeat(40),
  workingDirectory: ".",
  tsconfig: "tsconfig.json",
  install: "npm ci",
  patchFile: null,
  setupDirectory: null,
});

const summary: CollectSummary = {
  fileCount: 3,
  componentCount: 2,
  stateCount: 5,
  handlerCount: 4,
  unreachableBranchCount: 0,
  truncatedComponentCount: 0,
  bindingCount: 6,
  untypedBindingCount: 0,
  unresolvedTypeBindingCount: 0,
  bailoutCountsByReason: {},
  durationMs: 10,
  verification: null,
};

const runDirectory = mkdtempSync(join(tmpdir(), "bippy-conformance-results-"));
mkdirSync(join(runDirectory, "passing"));
writeFileSync(join(runDirectory, "passing/summary.json"), JSON.stringify(summary));
mkdirSync(join(runDirectory, "failing"));
writeFileSync(join(runDirectory, "failing/error.txt"), "setup failed");

afterAll(() => rmSync(runDirectory, { recursive: true, force: true }));

describe("readRepoResult", () => {
  it("reads a summary", () => {
    const result = readRepoResult(repo("passing"), join(runDirectory, "passing"));
    expect(result.summary).toEqual(summary);
    expect(result.error).toBeNull();
    expect(hasFailure(result)).toBe(false);
  });

  it("reads an error", () => {
    const result = readRepoResult(repo("failing"), join(runDirectory, "failing"));
    expect(result.summary).toBeNull();
    expect(result.error).toBe("setup failed");
    expect(hasFailure(result)).toBe(true);
  });

  it("treats a missing folder as a failure", () => {
    const result = readRepoResult(repo("absent"), join(runDirectory, "absent"));
    expect(result.error).toContain("no results");
    expect(hasFailure(result)).toBe(true);
  });
});

describe("formatTable", () => {
  it("lists every repo with its counts or failure", () => {
    const table = formatTable([
      readRepoResult(repo("passing"), join(runDirectory, "passing")),
      readRepoResult(repo("failing"), join(runDirectory, "failing")),
    ]);
    expect(table).toContain("passing  3");
    expect(table).toContain("failing  failed");
    expect(table).toContain("failing: setup failed");
  });
});
