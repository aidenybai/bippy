import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { getComponent } from "./helpers";

const BRANCH_COUNT = 1000;
const TIMEOUT_MS = 30_000;

const createComponentSource = (name: string, createStatement: (index: number) => string): string =>
  `export const ${name} = ({ flags }: { flags: boolean[] }) => {\n  let total = 0;\n${Array.from({ length: BRANCH_COUNT }, (_branch, index) => `  ${createStatement(index)}`).join("\n")}\n  return <p>{total}</p>;\n};\n`;

const createDeepBranchesProject = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-deep-branches-"));
  writeFileSync(
    join(directory, "sequential-branches.tsx"),
    createComponentSource(
      "SequentialBranches",
      (index) => `if (flags[${index}]) total += ${index};`,
    ),
  );
  writeFileSync(
    join(directory, "early-returns.tsx"),
    createComponentSource(
      "EarlyReturns",
      (index) => `if (flags[${index}]) return <p>${index}</p>;`,
    ),
  );
  writeFileSync(
    join(directory, "recursive-merge.tsx"),
    `const isPlainObject = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const RecursiveMerge = ({ base, override }: { base: any; override: any }) => {
  function deepMerge(left: any, right: any): any {
    if (Array.isArray(left)) return Array.isArray(right) ? right : left;
    if (isPlainObject(left)) {
      const merged: any = Object.assign({}, left);
      if (isPlainObject(right)) {
        for (const key of Object.keys(right)) {
          if (key === "__proto__") continue;
          if (!Object.prototype.hasOwnProperty.call(right, key)) continue;
          merged[key] = isPlainObject(left[key]) ? deepMerge(left[key], right[key]) : right[key];
        }
      }
      return merged;
    }
    return right !== undefined ? right : left;
  }
  const props = deepMerge(base, override);
  return <p>{typeof props === "object" && props !== null ? "merged" : String(props)}</p>;
};
`,
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
  const getBailoutReasons = (fileFilter: string, name: string): string[] =>
    getComponent(
      analyzeProject(join(directory, "tsconfig.json"), fileFilter),
      name,
    ).analysis.bailouts.map((bailout) => bailout.reason);

  it(
    "bails out instead of overflowing the stack on a long run of branches",
    () => {
      expect(getBailoutReasons("sequential-branches", "SequentialBranches")).toContain(
        "too-complex",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "analyzes a recursive merge without overflowing the stack",
    () => {
      expect(() => getBailoutReasons("recursive-merge", "RecursiveMerge")).not.toThrow();
    },
    TIMEOUT_MS,
  );

  it(
    "bails out instead of overflowing the stack on a long run of early returns",
    () => {
      expect(getBailoutReasons("early-returns", "EarlyReturns")).toContain("too-complex");
    },
    TIMEOUT_MS,
  );
});
