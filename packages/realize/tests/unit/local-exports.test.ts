import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { getTopLevelNames, toLocalExportName } from "../conformance/verifier/harness/local-exports";

const writeSource = (source: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "local-exports-")), "panel.tsx");
  writeFileSync(file, source);
  return file;
};

describe("local exports", () => {
  it("lists only names declared at the top of a module", () => {
    const file = writeSource(`
      const Header = () => <h1>Title</h1>;
      function Footer() { const Inner = () => null; return <Inner />; }
      export const Panel = () => <Header />;
    `);
    expect([...getTopLevelNames(file)].sort()).toEqual(["Footer", "Header"]);
  });

  it("gives each local component an export name no module would choose", () => {
    expect(toLocalExportName("Header")).not.toBe("Header");
    expect(toLocalExportName("Header")).toContain("Header");
  });
});
