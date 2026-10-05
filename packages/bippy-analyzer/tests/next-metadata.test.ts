import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vite-plus/test";
import { renderFrameworkTarget } from "../src/frameworks/index.js";
import { usesNextMetadataTree } from "../src/frameworks/next-metadata.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";

const writeFixture = (directory: string, filename: string, source: string): void => {
  const filePath = join(directory, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
};

const withFixture = async (run: (directory: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-next-metadata-"));
  try {
    writeFixture(
      directory,
      "package.json",
      JSON.stringify({ name: "metadata-fixture", private: true }),
    );
    writeFixture(
      directory,
      "node_modules/next/package.json",
      JSON.stringify({ name: "next", version: "13.2.4" }),
    );
    writeFixture(
      directory,
      "node_modules/next/dist/lib/metadata/resolve-metadata.ts",
      `
      export const collectMetadata = async (tree, props, items) => {
        const module = await tree[2].layout[0]();
        items.push([module?.generateMetadata ? () => module.generateMetadata(props) : module?.metadata, null]);
      };
    `,
    );
    writeFixture(
      directory,
      "node_modules/next/dist/lib/metadata/metadata.tsx",
      `
      export const MetadataTree = async ({ metadata }) => {
        const elements = [];
        for (const [metadataExport] of metadata) {
          const value = typeof metadataExport === "function" ? await metadataExport() : metadataExport;
          if (value) elements.push(<output>{value.title}{"!"}</output>);
        }
        return elements;
      };
    `,
    );
    writeFixture(
      directory,
      "app/layout.tsx",
      `
      export const generateMetadata = (props) => ({ title: props.searchParams === undefined ? "root" : "wrong-root-props" });
      export default ({ children }) => <html><body><header /><section>{children}</section></body></html>;
    `,
    );
    writeFixture(
      directory,
      "app/[slug]/layout.tsx",
      `
      export const metadata = { title: "nested" };
      export default ({ children }) => <article>{children}</article>;
    `,
    );
    writeFixture(
      directory,
      "app/[slug]/page.tsx",
      `
      export const generateMetadata = (props) => ({ title: props.params.slug + ":" + props.searchParams.query });
      export default () => <main />;
    `,
    );
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const renderFixture = (directory: string, route = "/entry?query=value") =>
  renderFrameworkTarget({ framework: "next-app", route }, { rootDirectory: directory });

it("interprets metadata helpers and inserts their output inside the root layout", () =>
  withFixture(async (directory) => {
    const result = await renderFixture(directory);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const tree = formatPattern(getRenderPattern(result));
    expect(tree).toContain('"root"');
    expect(tree).toContain('"nested"');
    expect(tree).toContain('"entry:value"');
    expect(tree.lastIndexOf("<output>")).toBeLessThan(tree.indexOf("<article>"));
  }));

it("places metadata inside the root template and loading boundary", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "app/template.tsx",
      "export default ({ children }) => <nav>{children}</nav>;",
    );
    writeFixture(directory, "app/loading.tsx", "export default () => <aside />;");
    const result = await renderFixture(directory);
    const tree = formatPattern(getRenderPattern(result));
    expect(tree.indexOf("<output>")).toBeGreaterThan(tree.indexOf("<nav>"));
    expect(tree.indexOf("<output>")).toBeGreaterThan(tree.indexOf("<Suspense>"));
  }));

it("places grouped-root metadata before the root layout", () =>
  withFixture(async (directory) => {
    renameSync(join(directory, "app"), join(directory, "grouped-app"));
    mkdirSync(join(directory, "app"));
    renameSync(join(directory, "grouped-app"), join(directory, "app/(group)"));
    const result = await renderFixture(directory);
    const tree = formatPattern(getRenderPattern(result));
    expect(tree).toContain("<output>");
    expect(tree.lastIndexOf("<output>")).toBeLessThan(tree.indexOf("<html>"));
  }));

it("does not execute application bodies natively", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "app/[slug]/page.tsx",
      `
      export const generateMetadata = () => {
        Reflect.set(globalThis, "__bippyMetadataApplicationExecuted", true);
        return { title: "interpreted" };
      };
      export default () => {
        Reflect.set(globalThis, "__bippyMetadataApplicationExecuted", true);
        return <main />;
      };
    `,
    );
    expect(Reflect.has(globalThis, "__bippyMetadataApplicationExecuted")).toBe(false);
    try {
      const result = await renderFixture(directory);
      expect(formatPattern(getRenderPattern(result))).toContain('"interpreted"');
      expect(Reflect.has(globalThis, "__bippyMetadataApplicationExecuted")).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, "__bippyMetadataApplicationExecuted");
    }
  }));

it("does not collect metadata exports from client modules", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "app/[slug]/page.tsx",
      '"use client"; export const metadata = { title: "client-only" }; export default () => <main />;',
    );
    const result = await renderFixture(directory);
    const tree = formatPattern(getRenderPattern(result));
    expect(tree).toContain('"root"');
    expect(tree).not.toContain('"client-only"');
  }));

it("preserves repeated search parameters as arrays", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "app/[slug]/page.tsx",
      `
    export const generateMetadata = ({ searchParams }) => ({ title: searchParams.query.join(",") });
    export default () => <main />;
  `,
    );
    const result = await renderFixture(directory, "/entry?query=first&query=second");
    expect(formatPattern(getRenderPattern(result))).toContain('"first,second"');
  }));

it("selects the deepest legacy head and supplies its segment params", () =>
  withFixture(async (directory) => {
    writeFixture(directory, "app/head.tsx", "export default () => <small />;");
    writeFixture(
      directory,
      "app/[slug]/head.tsx",
      'export default ({ params }) => <nav>{params.slug}{"!"}</nav>;',
    );
    const result = await renderFixture(directory);
    const tree = formatPattern(getRenderPattern(result));
    expect(tree).not.toContain("<small>");
    expect(tree).toContain('"entry"');
    expect(tree.indexOf("<nav>")).toBeGreaterThan(tree.lastIndexOf("<output>"));
    expect(tree.indexOf("<nav>")).toBeLessThan(tree.indexOf("<article>"));
  }));

it("keeps incomplete metadata collection unknown", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "node_modules/next/dist/lib/metadata/resolve-metadata.ts",
      "export const collectMetadata = () => ({ pending: true });",
    );
    const result = await renderFixture(directory);
    expect(formatPattern(getRenderPattern(result))).toContain(
      "Next metadata collection did not complete",
    );
  }));

it("retains errors from metadata collection", () =>
  withFixture(async (directory) => {
    writeFixture(
      directory,
      "node_modules/next/dist/lib/metadata/resolve-metadata.ts",
      'export const collectMetadata = () => { throw new Error("metadata-failure"); };',
    );
    const result = await renderFixture(directory);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("metadata-failure")),
      JSON.stringify({
        diagnostics: result.diagnostics,
        pattern: formatPattern(getRenderPattern(result)),
      }),
    ).toBe(true);
  }));

it("does not invent metadata when installed helpers are missing", () =>
  withFixture(async (directory) => {
    rmSync(join(directory, "node_modules/next/dist/lib/metadata/metadata.tsx"));
    const result = await renderFixture(directory);
    expect(formatPattern(getRenderPattern(result))).toContain(
      "Next MetadataTree source is unavailable",
    );
  }));

it("does not discard file-based metadata", () =>
  withFixture(async (directory) => {
    writeFixture(directory, "app/icon0.svg", '<svg xmlns="http://www.w3.org/2000/svg" />');
    const result = await renderFixture(directory);
    expect(formatPattern(getRenderPattern(result))).toContain("metadata image loader");
  }));

it("keeps unsupported catch-all metadata props unknown", () =>
  withFixture(async (directory) => {
    renameSync(join(directory, "app/[slug]"), join(directory, "app/[...slug]"));
    const result = await renderFixture(directory, "/first/second");
    expect(formatPattern(getRenderPattern(result))).toContain("catch-all params are not modeled");
  }));

it("keeps parallel-route metadata collection unknown", () =>
  withFixture(async (directory) => {
    mkdirSync(join(directory, "app/@modal"));
    const result = await renderFixture(directory);
    expect(formatPattern(getRenderPattern(result))).toContain(
      "parallel-route metadata collection is not modeled",
    );
  }));

it("does not silently omit metadata without a root layout", () =>
  withFixture(async (directory) => {
    rmSync(join(directory, "app/layout.tsx"));
    rmSync(join(directory, "app/[slug]/layout.tsx"));
    const result = await renderFixture(directory);
    expect(formatPattern(getRenderPattern(result))).toContain(
      "MetadataTree requires a root layout",
    );
  }));

it.each([
  [null, false],
  ["13.1.6", false],
  ["13.2.0", true],
  ["13.2.4", true],
  ["13.3.0", false],
  ["14.0.0", false],
])("selects the metadata helper contract for %s", (version, expected) => {
  expect(usesNextMetadataTree(version)).toBe(expected);
});
