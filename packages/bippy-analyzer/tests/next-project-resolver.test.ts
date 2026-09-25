import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { createResolver } from "../src/core.js";

const fixtureRoot = fileURLToPath(new URL("../.resolver-fixtures/", import.meta.url));
mkdirSync(fixtureRoot, { recursive: true });
const directories: string[] = [];
const createProject = (configuration: string) => {
  const directory = mkdtempSync(join(fixtureRoot, "next-policy-"));
  directories.push(directory);
  mkdirSync(join(directory, "app"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "next-policy-fixture", private: true }),
  );
  writeFileSync(join(directory, "next.config.js"), configuration);
  writeFileSync(join(directory, "app/page.tsx"), "export default () => null;");
  for (const name of ["browser", "server", "changed"])
    writeFileSync(
      join(directory, `${name}.js`),
      "throw new Error('Application modules must not execute during configuration discovery');",
    );
  return { directory, importer: join(directory, "app/page.tsx") };
};
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("installed Next configuration", () => {
  it("executes wrappers and callbacks once per context without inheriting host secrets", () => {
    const project = createProject(`
      const fs = require('node:fs');
      const path = require('node:path');
      if (process.env.BIPPY_CONFIG_SECRET) throw new Error('Host environment leaked');
      console.warn('fixture-configuration-warning');
      const wrap = (nextConfig) => ({...nextConfig, webpack: (config, context) => {
        fs.appendFileSync(path.join(__dirname, 'calls'), context.isServer ? 'server\\n' : 'browser\\n');
        config.resolve.alias['@dynamic'] = path.join(__dirname, context.isServer ? 'server.js' : 'browser.js');
        return nextConfig.webpack(config, context);
      }});
      module.exports = wrap(wrap({webpack: (config) => config}));
    `);
    const previous = process.env.BIPPY_CONFIG_SECRET;
    process.env.BIPPY_CONFIG_SECRET = "not-for-child-processes";
    try {
      const resolver = createResolver({
        rootDirectory: project.directory,
        platform: "browser",
        mode: "development",
        allowConfigExecution: true,
      });
      expect(resolver.resolve("@dynamic", project.importer)).toEqual({
        kind: "file",
        id: join(project.directory, "browser.js"),
      });
      expect(resolver.resolve("@dynamic", project.importer, { kind: "require" })).toEqual({
        kind: "file",
        id: join(project.directory, "browser.js"),
      });
      expect(resolver.resolve("@dynamic", project.importer, { platform: "node" })).toEqual({
        kind: "file",
        id: join(project.directory, "server.js"),
      });
      expect(resolver.getConfiguration(project.importer).nextVersion).toBe("15.5.18");
      expect(resolver.getConfiguration(project.importer).configurationOutput).toContain(
        "fixture-configuration-warning",
      );
      expect(readFileSync(join(project.directory, "calls"), "utf8")).toBe(
        "browser\nbrowser\nserver\nserver\n",
      );
      expect(resolver.resolve("node:fs", project.importer).kind).toBe("unresolved");
      expect(resolver.resolve("node:fs", project.importer, { platform: "node" })).toEqual({
        kind: "builtin",
        id: "node:fs",
      });
      writeFileSync(
        join(project.directory, "next.config.js"),
        `module.exports = {webpack: (config) => {config.resolve.alias['@dynamic'] = require('node:path').join(__dirname, 'changed.js'); return config;}};`,
      );
      resolver.clearCache();
      expect(resolver.resolve("@dynamic", project.importer)).toEqual({
        kind: "file",
        id: join(project.directory, "changed.js"),
      });
    } finally {
      if (previous === undefined) delete process.env.BIPPY_CONFIG_SECRET;
      else process.env.BIPPY_CONFIG_SECRET = previous;
    }
  }, 20000);

  it("requires explicit authorization before executing project code", () => {
    const project = createProject("module.exports = () => {throw new Error('must not execute');};");
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser" }).resolve(
        "@dynamic",
        project.importer,
      ),
    ).toMatchObject({
      kind: "unresolved",
      error: expect.stringContaining("Dynamic configuration"),
    });
  });

  it("bounds a nonterminating configuration and caches the failure", () => {
    const project = createProject("while (true) {};");
    const resolver = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
      allowConfigExecution: true,
      configTimeoutMs: 1000,
    });
    const first = resolver.resolve("@dynamic", project.importer);
    expect(first).toMatchObject({
      kind: "unresolved",
      error: expect.stringContaining("ETIMEDOUT"),
    });
    writeFileSync(join(project.directory, "next.config.js"), "module.exports = {};");
    expect(resolver.resolve("@other", project.importer)).toMatchObject({
      kind: "unresolved",
      error: expect.stringContaining("ETIMEDOUT"),
    });
  }, 5000);

  it.each(["{apply() {}}", "new (class JsConfigPathsPlugin {apply() {}})()"])(
    "rejects unsupported resolve.plugins entries: %s",
    (plugin) => {
      const project = createProject(
        `module.exports = {webpack: (config) => {config.resolve.plugins.push(${plugin}); return config;}};`,
      );
      expect(
        createResolver({
          rootDirectory: project.directory,
          platform: "browser",
          allowConfigExecution: true,
        }).resolve("@dynamic", project.importer),
      ).toMatchObject({
        kind: "unresolved",
        error: expect.stringContaining("Unsupported resolver plugins"),
      });
    },
    15000,
  );
});
