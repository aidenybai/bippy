import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { rolldown, type PluginContext, type InputOptions } from "rolldown";
import { createRolldownModuleResolver } from "../src/rolldown-module-resolver.js";
import { createModuleResolver } from "../src/module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const project = createResolverProject();
const entry = project.write("entry.js", "export const value = 1;");
for (const filename of [
  "value.js",
  "value.ts",
  "require.cjs",
  "browser.js",
  "node.js",
  "default.js",
])
  project.write(filename, "export const value = 1;");
project.write("node_modules/conditional/package.json", {
  exports: { browser: "./browser.js", node: "./node.js", default: "./default.js" },
});
project.write("node_modules/kinds/package.json", {
  exports: { require: "./require.cjs", import: "./value.js" },
});
for (const name of ["conditional", "kinds"])
  for (const filename of ["browser.js", "node.js", "default.js", "require.cjs", "value.js"])
    project.write(`node_modules/${name}/${filename}`, "export const value = 1;");
project.write("node_modules/ignored/package.json", {
  main: "./index.js",
  browser: { "./index.js": false },
});
project.write("node_modules/ignored/index.js", "");

const withContext = async (
  options: InputOptions,
  check: (context: PluginContext) => Promise<void>,
) => {
  let checked = false;
  const bundle = await rolldown({
    ...options,
    cwd: project.directory,
    input: entry,
    plugins: [
      ...(options.plugins ? [options.plugins] : []),
      {
        name: "resolution-observer",
        async buildStart() {
          await check(this);
          checked = true;
        },
      },
    ],
  });
  try {
    await bundle.generate({ format: "esm" });
    expect(checked).toBe(true);
  } finally {
    await bundle.close();
  }
};

it.each(["browser", "node", "neutral"] satisfies Array<"browser" | "node" | "neutral">)(
  "uses Rolldown's %s platform instead of Vite defaults",
  async (platform) => {
    await withContext({ platform }, async (context) => {
      const resolver = createRolldownModuleResolver(context);
      const condition = platform === "neutral" ? "default" : platform;
      expect(await resolver.resolve("conditional", entry)).toEqual({
        kind: "file",
        id: join(project.directory, `node_modules/conditional/${condition}.js`),
      });
      expect(await resolver.resolve("./value", entry)).toEqual({
        kind: "file",
        id: join(project.directory, "value.ts"),
      });
      expect(
        createModuleResolver({
          conditionNames: ["import", condition],
          extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
          mainFields:
            platform === "neutral"
              ? []
              : platform === "node"
                ? ["main", "module"]
                : ["browser", "module", "main"],
        }).resolve("./value", entry),
      ).toEqual({ kind: "file", id: join(project.directory, "value.ts") });
    });
  },
);

it.each(["import-statement", "dynamic-import", "require-call"] satisfies Array<
  "import-statement" | "dynamic-import" | "require-call"
>)("forwards the %s dependency kind", async (kind) => {
  await withContext({ platform: "node" }, async (context) => {
    expect(await createRolldownModuleResolver(context).resolve("kinds", entry, { kind })).toEqual({
      kind: "file",
      id: join(
        project.directory,
        `node_modules/kinds/${kind === "require-call" ? "require.cjs" : "value.js"}`,
      ),
    });
  });
});

it("preserves plugins, custom options, entry status, ignored targets, and errors", async () => {
  await withContext(
    {
      platform: "browser",
      plugins: [
        {
          name: "virtual-fixture",
          resolveId: (specifier, _importer, options) => {
            if (
              specifier === "virtual:context" &&
              options.isEntry &&
              options.custom?.fixture?.enabled
            )
              return "\0virtual:result";
            if (specifier === "plugin:builtin-name") return { id: "node:fs", external: false };
            if (specifier === "plugin:failure")
              throw new Error("intentional Rolldown plugin failure");
          },
        },
      ],
    },
    async (context) => {
      const resolver = createRolldownModuleResolver(context);
      expect(
        await resolver.resolve("virtual:context", entry, {
          isEntry: true,
          custom: { fixture: { enabled: true } },
        }),
      ).toEqual({ kind: "virtual", id: "\0virtual:result" });
      expect(await resolver.resolve("plugin:builtin-name", entry)).toEqual({
        kind: "virtual",
        id: "node:fs",
      });
      expect(await resolver.resolve("ignored", entry)).toEqual({
        kind: "ignored",
        specifier: "ignored",
      });
      expect(await resolver.resolve("not-installed", entry)).toMatchObject({ kind: "unresolved" });
      const failure = await resolver.resolve("plugin:failure", entry);
      expect(failure).toMatchObject({
        kind: "unresolved",
        error: expect.stringContaining("intentional Rolldown plugin failure"),
      });
    },
  );
});

it("preserves external decisions before and after filesystem resolution", async () => {
  const absolute = join(project.directory, "value.js");
  await withContext(
    {
      platform: "node",
      external: (specifier, _importer, isResolved) =>
        specifier === "external-before" || (isResolved && specifier === absolute),
      plugins: [
        {
          name: "absolute-external",
          resolveId: (specifier) =>
            specifier === "external-absolute" ? { id: absolute, external: "absolute" } : null,
        },
      ],
    },
    async (context) => {
      const resolver = createRolldownModuleResolver(context);
      expect(await resolver.resolve("external-before", entry)).toEqual({
        kind: "external",
        id: "external-before",
      });
      expect(await resolver.resolve("./value.js", entry)).toEqual({
        kind: "external",
        id: absolute,
      });
      expect(await resolver.resolve("external-absolute", entry)).toEqual({
        kind: "external",
        id: absolute,
        external: "absolute",
      });
      expect(await resolver.resolve("node:fs", entry)).toEqual({ kind: "builtin", id: "node:fs" });
    },
  );
});

it("agrees with the modules selected by a real Rolldown build", async () => {
  const source = project.write(
    "bundle.js",
    "import {value} from 'kinds'; import {value as other} from './value'; console.log(value, other);",
  );
  const resolved: string[] = [];
  const modules: string[] = [];
  const bundle = await rolldown({
    input: source,
    cwd: project.directory,
    platform: "browser",
    plugins: [
      {
        name: "observe-requests",
        moduleParsed: (module) => {
          modules.push(module.id);
        },
        async buildStart() {
          const resolver = createRolldownModuleResolver(this);
          for (const specifier of ["kinds", "./value"]) {
            const result = await resolver.resolve(specifier, source, { kind: "import-statement" });
            expect(result.kind).toBe("file");
            if (result.kind === "file") resolved.push(result.id);
          }
        },
      },
    ],
  });
  try {
    await bundle.generate({ format: "esm" });
    expect(resolved).toEqual([
      join(project.directory, "node_modules/kinds/value.js"),
      join(project.directory, "value.ts"),
    ]);
    for (const id of resolved) expect(modules).toContain(id);
  } finally {
    await bundle.close();
  }
});
