import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { transformAsync } from "@babel/core";
import { transform as transformSvgr } from "@svgr/core";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type Plugin, type PluginOption, transformWithOxc } from "vite-plus";
import { z } from "zod";
import { flatYamlPlugin } from "./tests/fixtures/vite-yaml-plugin/yaml-plugin.js";

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

const fixtureSvgrManifestSchema = z.object({
  svgr: z.record(z.string(), z.json()).optional(),
});

const readFixtureSvgrConfig = (id: string): Record<string, unknown> | null => {
  const [fixtureName] = relative(fixturesDirectory, id).split(sep);
  const manifestPath = join(fixturesDirectory, fixtureName, "fixture.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = fixtureSvgrManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  return manifest.svgr ?? null;
};

// A `fixture.json` `svgr` config goes straight to `@svgr/core` (as
// `esbuild-plugin-svgr` does); otherwise `react-scripts` semantics apply
// (`@svgr/webpack` chained after `file-loader`).
const fixtureSvgrPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-svgr",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".svg") || relative(fixturesDirectory, id).startsWith("..")) return null;
    const svgText = readFileSync(id, "utf8");
    const svgrConfig = readFixtureSvgrConfig(id);
    const componentCode =
      svgrConfig === null
        ? await transformSvgr(
            svgText,
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
          )
        : await transformSvgr(svgText, svgrConfig, { filePath: id });
    return transformWithOxc(componentCode, `${id}.jsx`, { jsx: { runtime: "automatic" } });
  },
});

// What `vite-plugin-svgr` does with its default `include` of `**/*.svg?react`:
// svgr with `@svgr/plugin-jsx` as the only default plugin and no caller name.
// (The plugin itself types against a different `vite` than `vite-plus` bundles.)
const fixtureViteSvgrPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-vite-svgr",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".svg?react") || relative(fixturesDirectory, id).startsWith("..")) return null;
    const filePath = id.slice(0, -"?react".length);
    const componentCode = await transformSvgr(
      readFileSync(filePath, "utf8"),
      { plugins: ["@svgr/plugin-jsx"] },
      { filePath },
    );
    return transformWithOxc(componentCode, id, { lang: "jsx" });
  },
});

// What `@stylexjs/unplugin` does in a dev server: compile `stylex.create` and
// friends away with the babel plugin in debug mode, leaving `props` to run.
const fixtureStylexPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-stylex",
  enforce: "pre",
  async transform(code, id) {
    if (!code.includes("@stylexjs/stylex") || relative(componentsDirectory, id).startsWith(".."))
      return null;
    const result = await transformAsync(code, {
      babelrc: false,
      configFile: false,
      cwd: parserDirectory,
      filename: id,
      parserOpts: { plugins: ["jsx", "typescript"] },
      plugins: [
        [
          "@stylexjs/babel-plugin",
          {
            dev: true,
            runtimeInjection: false,
            unstable_moduleResolution: { type: "commonJS", rootDir: parserDirectory },
          },
        ],
      ],
    });
    return result?.code === undefined || result.code === null
      ? null
      : { code: result.code, map: result.map };
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

const fixtureTanStackRouterPlugin = (): PluginOption => {
  const fixtureDirectory = join(fixturesDirectory, "tanstack-router-split");
  return tanstackRouter({
    target: "react",
    autoCodeSplitting: true,
    codeSplittingOptions: { addHmr: false },
    routesDirectory: join(fixtureDirectory, "src/routes"),
    generatedRouteTree: join(fixtureDirectory, "src/routeTree.gen.ts"),
  });
};

export default defineConfig({
  root: parserDirectory,
  plugins: [
    fixtureAliasPlugin(),
    fixtureSvgrPlugin(),
    fixtureViteSvgrPlugin(),
    fixtureStylexPlugin(),
    fixtureJsxInJsPlugin(),
    fixtureTanStackRouterPlugin(),
    flatYamlPlugin(),
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
