import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadViteConfig, type ViteConfig } from "../src/graph/vite-config.js";

const SMALL = Buffer.from("<svg/>");
const LARGE = Buffer.alloc(5000, "a");
const LFS_POINTER = Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:0\n");

interface FixtureProject {
  rootDirectory: string;
  write: (fileName: string, source: string) => void;
  load: (options?: { devCommand?: string; devDirectory?: string }) => ViteConfig;
}

const projects: string[] = [];

const createProject = (): FixtureProject => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "vite-config-"));
  projects.push(rootDirectory);
  writeFileSync(path.join(rootDirectory, "package.json"), '{ "name": "app", "type": "module" }');
  const resolver = new ModuleResolver({ rootDirectory });
  return {
    rootDirectory,
    write: (fileName, source) => {
      const filePath = path.join(rootDirectory, fileName);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source);
    },
    load: (options = {}) =>
      loadViteConfig({
        rootDirectory,
        resolver,
        hasDeclaredDependency: () => false,
        readPackageVersion: () => null,
        ...options,
      }),
  };
};

const decide = (config: ViteConfig, content: Buffer, fileName = "icon.svg"): boolean | null =>
  config.shouldInlineAsset(path.join(config.root, fileName), content);

afterEach(() => {
  for (const directory of projects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("vite config discovery", () => {
  for (const extension of ["js", "mjs", "cjs", "ts", "mts", "cts"]) {
    it(`reads vite.config.${extension}`, () => {
      const project = createProject();
      project.write(
        `vite.config.${extension}`,
        "export default { build: { assetsInlineLimit: 0 } };\n",
      );
      expect(decide(project.load(), SMALL)).toBe(false);
    });
  }

  it("falls back to Vite's defaults without a config", () => {
    const project = createProject();
    const config = project.load();
    expect(config).toMatchObject({
      root: project.rootDirectory,
      publicDir: path.join(project.rootDirectory, "public"),
      base: "/",
      mode: "development",
    });
    expect(decide(config, SMALL)).toBe(true);
    expect(decide(config, LARGE)).toBe(false);
    expect(decide(config, LFS_POINTER)).toBe(false);
  });

  it("honors --config and --mode from the dev command", () => {
    const project = createProject();
    project.write("vite.config.ts", "export default { build: { assetsInlineLimit: 0 } };\n");
    project.write(
      "config/vite.dev.ts",
      "import { defineConfig } from 'vite';\nexport default defineConfig(({ mode }) => ({ base: `/${mode}/`, build: { assetsInlineLimit: 8192 } }));\n",
    );
    const config = project.load({ devCommand: "vite --config config/vite.dev.ts --mode staging" });
    expect(config.base).toBe("/staging/");
    expect(config.mode).toBe("staging");
    expect(decide(config, LARGE)).toBe(true);
  });

  it("looks the config up where the dev command runs before the app root", () => {
    const project = createProject();
    project.write("app/index.html", "");
    project.write(
      "vite.config.ts",
      "export default { root: 'app', build: { assetsInlineLimit: 0 } };\n",
    );
    const config = loadViteConfig({
      rootDirectory: path.join(project.rootDirectory, "app"),
      devDirectory: project.rootDirectory,
      resolver: new ModuleResolver({ rootDirectory: project.rootDirectory }),
      hasDeclaredDependency: () => false,
      readPackageVersion: () => null,
    });
    expect(config.root).toBe(path.join(project.rootDirectory, "app"));
    expect(decide(config, SMALL)).toBe(false);
  });

  it("resolves root, publicDir and base as Vite serves them", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "import path from 'node:path';\nexport default { root: path.join(__dirname, 'client'), publicDir: 'static', base: 'https://cdn.example.com/assets' };\n",
    );
    const config = project.load();
    expect(config.root).toBe(path.join(project.rootDirectory, "client"));
    expect(config.publicDir).toBe(path.join(project.rootDirectory, "client", "static"));
    expect(config.base).toBe("/assets");
    project.write("vite.config.ts", "export default { publicDir: false, base: './' };\n");
    expect(project.load()).toMatchObject({ publicDir: null, base: "/" });
  });
});

describe("build.assetsInlineLimit", () => {
  it("compares the content length against a numeric limit", () => {
    const project = createProject();
    project.write("vite.config.ts", "export default { build: { assetsInlineLimit: 10 } };\n");
    const config = project.load();
    expect(decide(config, Buffer.alloc(9))).toBe(true);
    expect(decide(config, Buffer.alloc(10))).toBe(false);
  });

  it("never inlines with `false`, `0` or `null`", () => {
    for (const limit of ["false", "0", "null"]) {
      const project = createProject();
      project.write(
        "vite.config.ts",
        `export default { build: { assetsInlineLimit: ${limit} } };\n`,
      );
      expect(decide(project.load(), Buffer.alloc(0))).toBe(false);
    }
  });

  it("applies the default limit to an `undefined` limit", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "export default { build: { assetsInlineLimit: undefined } };\n",
    );
    const config = project.load();
    expect(decide(config, Buffer.alloc(4095))).toBe(true);
    expect(decide(config, Buffer.alloc(4096))).toBe(false);
  });

  it("lets a callback decide with a non-nullish return", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "import { defineConfig } from 'vite';\nexport default defineConfig({ build: { assetsInlineLimit: (file: string) => (file.endsWith('favicon.svg') ? false : file.endsWith('logo.svg') ? true : undefined) } });\n",
    );
    const config = project.load();
    expect(decide(config, SMALL, "favicon.svg")).toBe(false);
    expect(decide(config, LARGE, "logo.svg")).toBe(true);
    expect(decide(config, SMALL, "other.svg")).toBe(true);
    expect(decide(config, LARGE, "other.svg")).toBe(false);
  });

  it("hands the callback the file's content", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "export default { build: { assetsInlineLimit: (_file: string, content: Buffer) => content.length > 4 } };\n",
    );
    const config = project.load();
    expect(decide(config, LARGE)).toBe(true);
    expect(decide(config, Buffer.alloc(3))).toBe(false);
  });

  it("leaves a limit the source does not decide undecided", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "export default { build: { assetsInlineLimit: Number(process.env.INLINE_LIMIT) } };\n",
    );
    expect(decide(project.load(), SMALL)).toBeNull();
  });

  it("leaves alternatives that disagree undecided but keeps their agreement", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "export default { build: { assetsInlineLimit: process.env.CI ? 0 : 8192 } };\n",
    );
    const config = project.load();
    expect(decide(config, SMALL)).toBeNull();
    expect(decide(config, Buffer.alloc(9000))).toBe(false);
  });

  it("reads through mergeConfig and a function config", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "import { defineConfig, mergeConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nconst base = { plugins: [react()], build: { sourcemap: true } };\nexport default defineConfig(({ command }) => mergeConfig(base, { build: { assetsInlineLimit: command === 'serve' ? 0 : 4096 } }));\n",
    );
    expect(decide(project.load(), SMALL)).toBe(false);
  });
});

describe("unplugin-auto-import", () => {
  const AUTO_IMPORT_CONFIG = [
    "import react from '@vitejs/plugin-react';",
    "import autoImport from 'unplugin-auto-import/vite';",
    "export default {",
    "  plugins: [",
    "    react(),",
    "    [",
    "      autoImport({",
    "        imports: ['react', { './src/format': ['format', ['format', 'formatNumber']] }],",
    "        dirs: ['src/hooks', 'src/components/**'],",
    "        ignore: ['useIgnored'],",
    "      }),",
    "    ],",
    "    false,",
    "  ],",
    "};",
    "",
  ].join("\n");

  const writeAutoImportProject = (project: FixtureProject): void => {
    project.write("vite.config.ts", AUTO_IMPORT_CONFIG);
    project.write(
      "src/hooks/use-counter.ts",
      "export const useCounter = () => useState(1);\nexport const useIgnored = () => 0;\n",
    );
    project.write("src/components/Badge/index.tsx", "export default () => <b />;\n");
    project.write("src/components/status-pill.tsx", "export default (count: number) => `${count}`;\n");
    project.write("src/components/theme.css", ".theme {}\n");
    project.write("src/format.ts", "export const format = (count: number) => `#${count}`;\n");
  };

  it("resolves preset, mapped, aliased and directory-scanned names for transformed files", () => {
    const project = createProject();
    writeAutoImportProject(project);
    const config = project.load();
    const appFile = path.join(project.rootDirectory, "src/app.tsx");
    expect(config.findAutoImport(appFile, "useState")).toEqual({
      specifier: "react",
      imported: { kind: "named", name: "useState" },
    });
    expect(config.findAutoImport(appFile, "formatNumber")).toEqual({
      specifier: "./src/format",
      imported: { kind: "named", name: "format" },
    });
    expect(config.findAutoImport(appFile, "useCounter")).toEqual({
      specifier: path.join(project.rootDirectory, "src/hooks/use-counter.ts"),
      imported: { kind: "named", name: "useCounter" },
    });
    expect(config.findAutoImport(appFile, "Badge")).toEqual({
      specifier: path.join(project.rootDirectory, "src/components/Badge/index.tsx"),
      imported: { kind: "default" },
    });
    expect(config.findAutoImport(appFile, "statusPill")).toEqual({
      specifier: path.join(project.rootDirectory, "src/components/status-pill.tsx"),
      imported: { kind: "default" },
    });
    expect(config.findAutoImport(appFile, "useIgnored")).toBeNull();
    expect(config.findAutoImport(appFile, "useUnknown")).toBeNull();
  });

  it("leaves files the plugin does not transform alone", () => {
    const project = createProject();
    writeAutoImportProject(project);
    const config = project.load();
    expect(
      config.findAutoImport(path.join(project.rootDirectory, "src/theme.css"), "useState"),
    ).toBeNull();
    expect(
      config.findAutoImport(
        path.join(project.rootDirectory, "node_modules/react/index.js"),
        "useState",
      ),
    ).toBeNull();
  });

  it("injects nothing when the plugin's options are not statically known", () => {
    const project = createProject();
    project.write(
      "vite.config.ts",
      "import autoImport from 'unplugin-auto-import/vite';\nexport default { plugins: [autoImport({ imports: ['react'], include: [/\\.tsx$/] })] };\n",
    );
    expect(
      project.load().findAutoImport(path.join(project.rootDirectory, "src/app.tsx"), "useState"),
    ).toBeNull();
  });
});
