import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";

const createProject = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-parse-errors-"));
  writeFileSync(join(directory, "fine.tsx"), "export const Fine = () => <p>fine</p>;\n");
  writeFileSync(
    join(directory, "broken.tsx"),
    "export const Broken = () => <html className={}>broken</html>;\n",
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

describe("parse errors", () => {
  const directory = createProject();
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("skips a file Babel can't parse and analyzes the rest", () => {
    const project = analyzeProject(join(directory, "tsconfig.json"), null);
    expect(project.components.map((component) => component.analysis.name)).toEqual(["Fine"]);
  });
});
