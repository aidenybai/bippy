import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent } from "./helpers";

const BRANCH_COUNT = 1000;

const createDeepBranchesProject = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-deep-branches-"));
  const branches = Array.from(
    { length: BRANCH_COUNT },
    (_branch, index) => `  if (flags[${index}]) total += ${index};`,
  ).join("\n");
  writeFileSync(
    join(directory, "deep-branches.tsx"),
    `export const DeepBranches = ({ flags }: { flags: boolean[] }) => {\n  let total = 0;\n${branches}\n  return <p>{total}</p>;\n};\n`,
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "react-jsx", strict: true, noEmit: true },
      include: ["*.tsx"],
    }),
  );
  return directory;
};

describe("deep branches", () => {
  const directory = createDeepBranchesProject();
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("bails out instead of overflowing the stack on a long run of branches", () => {
    const project = analyzeProject(join(directory, "tsconfig.json"));
    const reasons = getComponent(project, "DeepBranches").analysis.bailouts.map(
      (bailout) => bailout.reason,
    );
    expect(reasons).toContain("too-complex");
  }, 30_000);
});
