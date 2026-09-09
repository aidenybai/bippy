import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { transform as transformSvgr } from "@svgr/core";
import { defineConfig, type Plugin, transformWithOxc } from "vite-plus";
import { docsMetadataPlugin } from "./tests/fixtures/vite-plugin-modules/docs-metadata-plugin.js";

const parserDirectory = import.meta.dirname;
const bippyDirectory = resolve(parserDirectory, "../bippy");
const fixturesDirectory = resolve(parserDirectory, "tests/fixtures");
const componentsDirectory = resolve(parserDirectory, "tests/components");

const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

interface FixtureAlias {
  prefix: string;
  target: string;
}

const COMPONENT_ALIASES: FixtureAlias[] = [
  { prefix: "@shared/", target: join(componentsDirectory, "shared") },
  { prefix: "~/", target: componentsDirectory },
];

const resolveFile = (base: string): string | null => {
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`)];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
};

const applyAlias = (source: string, alias: FixtureAlias): string | null =>
  source.startsWith(alias.prefix)
    ? resolveFile(join(alias.target, source.slice(alias.prefix.length)))
    : null;

// Fixtures declare path aliases in their own tsconfig so the static resolver
// exercises tsconfig paths; this mirrors those mappings for the runtime import
// that vitest performs when rendering the same fixture with react-dom.
const fixtureAliasPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-alias",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer) return null;
    if (!relative(componentsDirectory, importer).startsWith("..")) {
      for (const alias of COMPONENT_ALIASES) {
        const resolved = applyAlias(source, alias);
        if (resolved) return resolved;
      }
      return null;
    }
    const relativeToFixtures = relative(fixturesDirectory, importer);
    if (relativeToFixtures.startsWith("..")) return null;
    const [fixtureName] = relativeToFixtures.split(sep);
    return applyAlias(source, {
      prefix: "@/",
      target: join(fixturesDirectory, fixtureName, "src"),
    });
  },
});

// What `react-scripts` makes of an `.svg` import (its webpack config chains
// `@svgr/webpack` after `file-loader`), so fixtures render the real svgr output.
const fixtureSvgrPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-svgr",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".svg") || relative(fixturesDirectory, id).startsWith("..")) return null;
    const componentCode = await transformSvgr(
      readFileSync(id, "utf8"),
      {
        plugins: ["@svgr/plugin-jsx"],
        svgo: false,
        prettier: false,
        titleProp: true,
        ref: true,
      },
      {
        filePath: id,
        caller: {
          name: "@svgr/webpack",
          previousExport: `export default ${JSON.stringify(`/static/media/${basename(id)}`)}`,
        },
      },
    );
    return transformWithOxc(componentCode, `${id}.jsx`, { jsx: { runtime: "automatic" } });
  },
});

const fixtureJsxInJsPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-jsx-in-js",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith(".js") || relative(fixturesDirectory, id).startsWith("..")) return null;
    return transformWithOxc(code, id, { lang: "jsx" });
  },
});

// The vite-plugin-modules fixture's own vite.config plugin, so react-dom renders the same modules the static side reads through it.
const fixtureDocsMetadataPlugin = (): Plugin => {
  const plugin = docsMetadataPlugin();
  return {
    name: plugin.name,
    enforce: "pre",
    transform(code, id) {
      return relative(fixturesDirectory, id).startsWith("..") ? null : plugin.transform(code, id);
    },
  };
};

export default defineConfig({
  root: parserDirectory,
  plugins: [
    fixtureAliasPlugin(),
    fixtureSvgrPlugin(),
    fixtureJsxInJsPlugin(),
    fixtureDocsMetadataPlugin(),
  ],
  resolve: {
    alias: [{ find: /^bippy$/, replacement: resolve(bippyDirectory, "src/index.ts") }],
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    name: "parser",
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        // Playwright's default viewport, which `DEFAULT_BROWSER_ENVIRONMENT` models for `matchMedia`.
        width: 1280,
        height: 720,
        // Fixtures reference stylesheets/scripts that do not exist; React DOM
        // suspends the commit on `<link precedence>` until load/error fires.
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    css: { include: [/\.module\.css$/] },
    testTimeout: 20_000,
  },
});
