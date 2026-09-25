import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createServer, type ViteDevServer } from "vite-plus";
import { createViteModuleResolver } from "../src/vite-module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const project = createResolverProject();
const marker = join(project.directory, "executed");
const target = project.write(
  "src/target.ts",
  `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected');`,
);
let server: ViteDevServer;
beforeAll(async () => {
  server = await createServer({
    root: project.directory,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "resolver-test",
        enforce: "pre",
        resolveId: (source) => {
          if (source === "virtual:fixture") return "\0fixture?raw#part";
          if (source === "external:fixture")
            return { id: "https://example.com/module.js", external: true };
          if (source === "plugin:fixture") return target;
          if (source === "plugin:failure") throw new Error("intentional plugin failure");
        },
      },
    ],
  });
});
afterAll(async () => {
  await server?.close();
});

it.each([
  { request: "virtual:fixture", expected: { kind: "virtual", id: "\0fixture?raw#part" } },
  {
    request: "external:fixture",
    expected: { kind: "external", id: "https://example.com/module.js" },
  },
  { request: "plugin:fixture", expected: { kind: "file", id: target } },
  { request: "./target.ts?raw#part", expected: { kind: "file", id: `${target}?raw#part` } },
])(
  "uses actual Vite plugins for $request without filesystem fallback",
  async ({ request, expected }) => {
    const resolver = createViteModuleResolver(server.environments.client);
    expect(await resolver.resolve(request, project.importer)).toEqual(expected);
    expect(existsSync(marker)).toBe(false);
  },
);

it("keeps client and SSR builtin decisions distinct", async () => {
  expect(
    await createViteModuleResolver(server.environments.client).resolve("node:fs", project.importer),
  ).toEqual({ kind: "ignored", specifier: "node:fs" });
  expect(
    await createViteModuleResolver(server.environments.ssr).resolve("node:fs", project.importer),
  ).toEqual({ kind: "builtin", id: "node:fs" });
});

it("preserves plugin failures and unresolved imports", async () => {
  const resolver = createViteModuleResolver(server.environments.client);
  expect(await resolver.resolve("plugin:failure", project.importer)).toMatchObject({
    kind: "unresolved",
    error: expect.stringContaining("intentional plugin failure"),
  });
  expect(await resolver.resolve("not-installed", project.importer)).toMatchObject({
    kind: "unresolved",
  });
});
