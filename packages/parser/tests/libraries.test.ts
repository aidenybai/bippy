import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";
import { isPurePackage } from "../src/libraries/pure-packages.js";

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

const AXIOS_SOURCE = `
import axios from "axios";
import { useEffect, useState } from "react";

interface Item {
  id: string;
}

const api = axios.create({ baseURL: "https://example.test", timeout: 500 });
api.interceptors.request.use((config) => {
  config.headers.Authorization = "Bearer token";
  return config;
});
api.interceptors.response.use(
  (response) => response.data,
  (error) => Promise.reject(error),
);

export default function Items() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  useEffect(() => {
    api
      .get<Item[]>("/items")
      .then((loaded) => setItems(loaded))
      .catch(() => setHasFailed(true));
  }, []);
  if (hasFailed) return <p>failed</p>;
  if (!items?.length) return <p>loading</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <span>item</span>
        </li>
      ))}
    </ul>
  );
}
`;

const AUTO_IMPORT_PROJECT: Record<string, string> = {
  "vite.config.ts": `
import autoImport from "unplugin-auto-import/vite";
export default {
  plugins: [autoImport({ imports: ["react"], dirs: ["src/hooks", "src/components/**"] })],
};
`,
  "src/hooks/use-counter.ts": "export const useCounter = () => useState(2);\n",
  "src/components/Badge/index.tsx": `
export default function Badge({ count }: { count: number }) {
  return count === 2 ? <b>{count}</b> : <i>{count}</i>;
}
`,
  "src/components/status-pill.tsx":
    "export default (count: number) => (count > 1 ? 'many' : 'one');\n",
  "src/app.tsx": `
export default function App() {
  const [count] = useCounter();
  const label = useMemo(() => statusPill(count), [count]);
  return (
    <section>
      <Badge count={count} />
      {label === "many" ? <p>{label}</p> : <em>{label}</em>}
    </section>
  );
}
`,
};

const renderProject = async (
  files: Record<string, string>,
  entryFileName: string,
): Promise<string> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-library-"));
  for (const [fileName, source] of Object.entries(files)) {
    const filePath = join(rootDirectory, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderComponent(join(rootDirectory, entryFileName), {
    exportName: "default",
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.stats.unknownCount).toBe(0);
  return formatPattern(getRenderPattern(result)).replaceAll(`${rootDirectory}/`, "");
};

const renderSource = (source: string): Promise<string> =>
  renderProject({ "app.tsx": source }, "app.tsx");

describe("library models", () => {
  it("binds the free identifiers unplugin-auto-import injects imports for", async () => {
    expect(await renderProject(AUTO_IMPORT_PROJECT, "src/app.tsx")).toBe(
      ["<HostRoot>", "  <App>", "    <section>", "      <Badge>", "        <b>", "      <p>"].join(
        "\n",
      ),
    );
  });

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

  it("treats lodash's per-method packages like the matching lodash export", () => {
    expect(isPurePackage("lodash.mergewith")).toBe(true);
    expect(isPurePackage("lodash.isequal")).toBe(true);
    expect(isPurePackage("lodash.debounce")).toBe(false);
    expect(isPurePackage("lodash.uniqueid")).toBe(false);
    expect(isPurePackage("lodash-webpack-plugin")).toBe(false);
  });

  it("keeps an Axios response pending so the request's outcomes stay enumerated", async () => {
    expect(await renderSource(AXIOS_SOURCE)).toBe(
      [
        "<HostRoot>",
        "  <Items>",
        "    ?branch(if (branch(false | true))) @ app.tsx:28:3",
        "      |0",
        "        <p>",
        "      |1 (preferred)",
        "        <p>",
        "      |2",
        "        <ul>",
        "          *repeat(0..) @ app.tsx:32:8",
        "            <li>",
        "              <span>",
      ].join("\n"),
    );
  });
});
