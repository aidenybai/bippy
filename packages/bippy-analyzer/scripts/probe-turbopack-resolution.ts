import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = join(root, "packages/bippy-analyzer/.resolver-fixtures");
mkdirSync(fixtures, { recursive: true });
const directory = mkdtempSync(join(fixtures, "turbopack-"));
const write = (path: string, contents: string | object) => {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === "string" ? contents : JSON.stringify(contents));
};

const main = async () => {
  write("package.json", { name: "turbopack-resolution-fixture", private: true });
  write("app/layout.tsx", "export default ({children}) => <html><body>{children}</body></html>;");
  write(
    "app/page.tsx",
    'import {value} from "conditional-fixture"; import Client from "./client"; export default () => <main>{value}<Client/></main>;',
  );
  write(
    "app/client.tsx",
    "'use client'; import {value} from \"conditional-fixture\"; export default () => <span>{value}</span>;",
  );
  write("node_modules/conditional-fixture/package.json", {
    name: "conditional-fixture",
    exports: {
      "react-server": "./server.js",
      browser: "./browser.js",
      node: "./node.js",
      default: "./fallback.js",
    },
  });
  const branches = ["server", "browser", "node", "fallback"];
  for (const name of branches)
    write(
      `node_modules/conditional-fixture/${name}.js`,
      `export const value = "BIPPY_${name.toUpperCase()}_CONDITION";`,
    );
  for (const name of ["next", "react", "react-dom"])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, "node_modules", name),
      "dir",
    );
  const loadConfig: typeof import("next/dist/server/config.js").default =
    require("next/dist/server/config").default;
  const swc: typeof import("next/dist/build/swc/index.js") = require("next/dist/build/swc");
  const config = await loadConfig("phase-production-build", directory);
  config.turbopack = { ...config.turbopack, root };
  const bindings = await swc.loadBindings();
  const distDir = join(directory, ".next");
  const rewrites = { beforeFiles: [], afterFiles: [], fallback: [] };
  const project = await bindings.turbo.createProject(
    {
      rootPath: root,
      projectPath: relative(root, directory),
      distDir,
      nextConfig: config,
      jsConfig: { compilerOptions: { jsx: "preserve" } },
      env: { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      watch: { enable: false },
      dev: false,
      defineEnv: swc.createDefineEnv({
        isTurbopack: true,
        config,
        dev: false,
        distDir,
        projectPath: directory,
        hasRewrites: false,
        rewrites,
        fetchCacheKeyPrefix: undefined,
        middlewareMatchers: undefined,
      }),
      buildId: "resolver-fixture",
      encryptionKey: "00000000000000000000000000000000",
      previewProps: {
        previewModeId: "resolver-fixture",
        previewModeEncryptionKey: "resolver-fixture",
        previewModeSigningKey: "resolver-fixture",
      },
      browserslistQuery: "Chrome 120",
      noMangling: true,
      currentNodeJsVersion: process.versions.node,
    },
    { persistentCaching: false, memoryLimit: 1024 * 1024 * 1024, isCi: true, isShortSession: true },
  );
  try {
    const result = await project.writeAllEntrypointsToDisk(true);
    const files = readdirSync(distDir, { recursive: true, encoding: "utf8" }).filter(
      (file) => typeof file === "string" && file.endsWith(".js"),
    );
    const outputs = files.map((file) => ({
      file,
      source: readFileSync(join(distDir, file), "utf8"),
    }));
    return {
      version: require("next/package.json").version,
      routes: [...result.routes.keys()],
      issues: result.issues.map((issue) => ({
        severity: issue.severity,
        stage: issue.stage,
        title: issue.title,
        filePath: issue.filePath,
      })),
      markers: Object.fromEntries(
        branches.map((name) => [
          name,
          outputs
            .filter((file) => file.source.includes(`BIPPY_${name.toUpperCase()}_CONDITION`))
            .map((file) => file.file),
        ]),
      ),
    };
  } finally {
    await project.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
};

void main().then(
  (report) => {
    writeFileSync(1, JSON.stringify(report));
    // HACK: Next's native project keeps the worker alive after shutdown.
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error);
    rmSync(directory, { recursive: true, force: true });
    process.exit(1);
  },
);
