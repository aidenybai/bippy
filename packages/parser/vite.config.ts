import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite-plus";

const parserDirectory = import.meta.dirname;
const bippyDirectory = resolve(parserDirectory, "../bippy");
const fixturesDirectory = resolve(parserDirectory, "tests/fixtures");

const FIXTURE_ALIAS_PREFIX = "@/";
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

// Fixtures declare `@/* -> src/*` in their own tsconfig so the static resolver
// exercises tsconfig paths; this mirrors that mapping for the runtime import
// that vitest performs when rendering the same fixture with react-dom.
const fixtureAliasPlugin = (): Plugin => ({
  name: "bippy-parser-fixture-alias",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || !source.startsWith(FIXTURE_ALIAS_PREFIX)) return null;
    const relativeToFixtures = relative(fixturesDirectory, importer);
    if (relativeToFixtures.startsWith("..")) return null;
    const [fixtureName] = relativeToFixtures.split(sep);
    const base = join(fixturesDirectory, fixtureName, "src", source.slice(FIXTURE_ALIAS_PREFIX.length));
    const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`)];
    return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
  },
});

export default defineConfig({
  root: parserDirectory,
  plugins: [fixtureAliasPlugin()],
  resolve: {
    alias: [{ find: /^bippy$/, replacement: resolve(bippyDirectory, "src/index.ts") }],
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    name: "parser",
    environment: "happy-dom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20_000,
  },
});
