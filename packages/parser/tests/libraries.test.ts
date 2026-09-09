import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

const LINARIA_SOURCE = `
import { styled } from "@linaria/react";
import { css } from "@linaria/core";

const Card = styled.section\`
  padding: 8px;
\`;

const Box = styled.div<{ gap?: number }>\`
  gap: \${(props) => props.gap ?? 0}px;
\`;

const Row = styled(Box)\`
  display: flex;
\`;

const emphasis = css\`
  font-style: italic;
\`;

export default () => (
  <Card>
    <Row gap={4}>
      <Box as="span" className={emphasis}>left</Box>
    </Row>
  </Card>
);
`;

const renderSource = async (source: string): Promise<string> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-library-"));
  const entryFile = join(rootDirectory, "app.tsx");
  writeFileSync(entryFile, source);
  const renderer = createStaticRenderer({ rootDirectory });
  const result = await renderer.renderComponent(entryFile, { exportName: "default" });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.stats.unknownCount).toBe(0);
  return formatPattern(getRenderPattern(result));
};

describe("library models", () => {
  it("names Linaria's template-form styled components after their binding as wyw-in-js does", async () => {
    expect(await renderSource(LINARIA_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <default>",
        "    <Card>",
        "      <section>",
        "        <Row>",
        "          <Box>",
        "            <div>",
        "              <Box>",
        "                <span>",
      ].join("\n"),
    );
  });
});
