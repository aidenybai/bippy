import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { StaticRenderer } from "../src/render/static-renderer.js";

interface EmotionVersionCase {
  react: string;
  styled: string;
  insertions: number;
  noops: number;
}

const CASES: EmotionVersionCase[] = [
  { react: "11.1.5", styled: "11.1.5", insertions: 0, noops: 3 },
  { react: "11.7.1", styled: "11.6.0", insertions: 0, noops: 3 },
  { react: "11.8.0", styled: "11.8.0", insertions: 3, noops: 0 },
  { react: "11.8.0", styled: "11.6.0", insertions: 2, noops: 1 },
  { react: "11.7.1", styled: "11.8.0", insertions: 1, noops: 2 },
];

const writePackage = (directory: string, name: string, version: string): void => {
  const packageDirectory = join(directory, "node_modules", name);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name, version, main: "index.ts" }),
  );
  writeFileSync(join(packageDirectory, "index.ts"), "export {};\n");
};

describe("Emotion insertion component versions", () => {
  it.each(CASES)("react $react / styled $styled", async ({ react, styled, insertions, noops }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-emotion-version-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ name: "emotion-version", private: true }),
      );
      writePackage(directory, "@emotion/react", react);
      writePackage(directory, "@emotion/styled", styled);
      const renderer = new StaticRenderer({ rootDirectory: directory });
      const filePath = join(directory, "app.tsx");
      renderer.graph.addVirtualModule(
        filePath,
        `
        import styled from "@emotion/styled";
        import { ClassNames, jsx } from "@emotion/react";
        const StyledSection = styled("section")({ color: "red" });
        export default () => <main>
          <StyledSection><strong /></StyledSection>
          {jsx("aside", { css: { color: "red" } }, <em />)}
          <ClassNames>{({ css }) => <footer className={css({ color: "red" })} />}</ClassNames>
        </main>;
      `,
      );
      const rendered = await renderer.renderComponent(filePath);
      const pattern = formatPattern(getRenderPattern(rendered));
      expect(pattern.split("<Insertion>").length - 1).toBe(insertions);
      expect(pattern.split("<Noop>").length - 1).toBe(noops);
      expect(pattern).toContain("<section>");
      expect(pattern).toContain("<aside>");
      expect(pattern).toContain("<footer>");
      expect(pattern).not.toContain("?unknown");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
