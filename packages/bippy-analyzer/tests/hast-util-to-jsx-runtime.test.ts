import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

it("materializes concrete react-markdown output without a wildcard", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "react-markdown-"));
  try {
    const filePath = join(rootDirectory, "markdown.tsx");
    writeFileSync(
      filePath,
      `
import Markdown from "react-markdown";

export const MarkdownCard = () => <Markdown>{"Hello **world**."}</Markdown>;
`,
    );
    const renderer = await createStaticRenderer({
      rootDirectory,
      externalPackageAllowList: ["react-markdown"],
    });
    const result = await renderer.renderComponent(filePath, { exportName: "MarkdownCard" });

    expect(formatPattern(getRenderPattern(result))).toBe(`<HostRoot>
  <MarkdownCard>
    <Markdown>
      <p> key="p-0"
        "Hello "
        <strong> key="strong-0"
        "."`);
    expect(result.stats.unknownCount).toBe(0);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

it("materializes supported React Markdown plugins without a wildcard", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "react-markdown-plugins-"));
  try {
    const filePath = join(rootDirectory, "markdown.tsx");
    writeFileSync(
      filePath,
      `
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";

export const MarkdownCard = () => (
  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
    {"~~old~~\\n\\n<section>raw</section>"}
  </Markdown>
);
`,
    );
    const renderer = await createStaticRenderer({
      rootDirectory,
      externalPackageAllowList: ["react-markdown"],
    });
    const result = await renderer.renderComponent(filePath, { exportName: "MarkdownCard" });
    const pattern = formatPattern(getRenderPattern(result));

    expect(pattern).toContain("<del>");
    expect(pattern).toContain("<section>");
    expect(result.stats.unknownCount).toBe(0);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
