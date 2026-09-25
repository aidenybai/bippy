import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vite-plus/test";
import { createNodeModuleResolver } from "../src/node-module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const project = createResolverProject();
project.write("package.json", {
  name: "node-project",
  type: "module",
  exports: "./src/value.js",
  imports: {
    "#value": "./src/value.js",
    "#bare": "fs",
    "#prefixed": "node:fs",
    "#blocked": null,
  },
});
for (const filename of [
  "value.js",
  "source.ts",
  "nested/index.js",
  "space name.js",
  "literal?query.js",
])
  project.write(`src/${filename}`, "export {};");
project.write("tsconfig.json", { compilerOptions: { paths: { mapped: ["./src/value.js"] } } });
project.write("node_modules/conditional/package.json", {
  type: "module",
  exports: {
    browser: "./browser.js",
    module: "./module.js",
    custom: "./custom.js",
    import: "./import.js",
    require: "./require.cjs",
    default: "./default.js",
  },
});
for (const filename of [
  "browser.js",
  "module.js",
  "custom.js",
  "import.js",
  "require.cjs",
  "default.js",
])
  project.write(`node_modules/conditional/${filename}`, "");
project.write("node_modules/legacy/package.json", {
  main: "./main.js",
  module: "./module.js",
  browser: "./browser.js",
});
for (const filename of ["main.js", "module.js", "browser.js"])
  project.write(`node_modules/legacy/${filename}`, "");
project.write("node_modules/blocked/package.json", {
  exports: { ".": "./main.js", "./secret": null },
});
project.write("node_modules/blocked/main.js", "");
project.write("node_modules/blocked/secret.js", "");
project.write("node_modules/missing-target/package.json", {
  exports: ["./missing.js", "./exists.js"],
});
project.write("node_modules/missing-target/exists.js", "");
project.write("node_modules/synchronous/package.json", {
  exports: { "module-sync": "./sync.js", default: "./default.js" },
});
project.write("node_modules/synchronous/sync.js", "");
project.write("node_modules/synchronous/default.js", "");
const requests = [
  "./value.js",
  "./value",
  "./nested",
  "./source.js",
  "mapped",
  "./space name.js",
  "./value.js?raw#part",
  "./literal?query.js",
  pathToFileURL(join(project.directory, "src/literal?query.js")).href,
  "conditional",
  "legacy",
  "blocked/secret",
  "blocked/secret.js",
  "missing-target",
  "synchronous",
  "node-project",
  "#value",
  "#bare",
  "#prefixed",
  "#blocked",
  "fs",
  "node:fs",
  "node:test",
  "node:does-not-exist",
  "not-installed",
];

it.each(["esm", "commonjs"] satisfies Array<"esm" | "commonjs">)(
  "matches native Node %s without bundler conditions or extension substitution",
  (kind) => {
    const resolver = createNodeModuleResolver({ kind });
    const actual = requests.map((request) => {
      const result = resolver.resolve(request, project.importer);
      return result.kind === "unresolved" ? { kind: "unresolved" } : result;
    });
    const native = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-import-meta-resolve",
          "--input-type=module",
          "--eval",
          `
    import {createRequire,isBuiltin} from 'node:module';
    import {pathToFileURL} from 'node:url';
    import {statSync} from 'node:fs';
    const importer=${JSON.stringify(project.importer)};
    const requests=${JSON.stringify(requests)};
    const results=requests.map((request)=>{
      try {
        const id=${kind === "esm" ? "import.meta.resolve(request,pathToFileURL(importer).href)" : "createRequire(importer).resolve(request)"};
        if(isBuiltin(id)) return {kind:'builtin',id:id.startsWith('node:')?id:'node:'+id};
        const url=${kind === "esm" ? "new URL(id)" : "pathToFileURL(id)"};
        if(url.protocol!=='file:' || !statSync(url).isFile()) throw new Error('Not a file');
        return {kind:'file',id:url.href};
      } catch {return {kind:'unresolved'};}
    });
    console.log(JSON.stringify(results));
  `,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(actual).toEqual(native);
    const file = (filename: string) => ({
      kind: "file",
      id: pathToFileURL(join(project.directory, filename)).href,
    });
    expect(resolver.resolve("conditional", project.importer)).toEqual(
      file(`node_modules/conditional/${kind === "esm" ? "import.js" : "require.cjs"}`),
    );
    expect(resolver.resolve("legacy", project.importer)).toEqual(
      file("node_modules/legacy/main.js"),
    );
    expect(resolver.resolve("./source.js", project.importer).kind).toBe("unresolved");
    expect(resolver.resolve("./nested", project.importer).kind).toBe(
      kind === "esm" ? "unresolved" : "file",
    );
    expect(resolver.resolve("#prefixed", project.importer).kind).toBe("unresolved");
    expect(resolver.resolve("#bare", project.importer).kind).toBe(
      kind === "esm" ? "builtin" : "unresolved",
    );
  },
);

it("uses explicit ESM conditions without changing the process or caller's policy", () => {
  const conditions = ["custom"];
  const resolver = createNodeModuleResolver({ kind: "esm", conditions });
  conditions[0] = "browser";
  const native = execFileSync(
    process.execPath,
    [
      "--experimental-import-meta-resolve",
      "--conditions=custom",
      "--input-type=module",
      "--eval",
      `console.log(import.meta.resolve('conditional',${JSON.stringify(pathToFileURL(project.importer).href)}));`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(native).toBe(
    pathToFileURL(join(project.directory, "node_modules/conditional/custom.js")).href,
  );
  expect(resolver.resolve("conditional", project.importer)).toEqual({ kind: "file", id: native });
});

it("keeps URL-escaped filenames distinct from queries without executing either file", () => {
  const resolver = createNodeModuleResolver({ kind: "esm" });
  const literal = pathToFileURL(join(project.directory, "src/literal?query.js")).href;
  expect(resolver.resolve(literal, project.importer)).toEqual({ kind: "file", id: literal });
  expect(resolver.resolve("./literal?query.js", project.importer).kind).toBe("unresolved");
  expect(resolver.resolve("./value.js?one#two", project.importer)).toEqual({
    kind: "file",
    id: `${pathToFileURL(join(project.directory, "src/value.js")).href}?one#two`,
  });
});

it.each(["./missing.js", "./nested"])(
  "agrees with native import rejection for %s, not import.meta.resolve's permissive URL result",
  (request) => {
    const native = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
    try { await import(${JSON.stringify(new URL(request, pathToFileURL(project.importer)).href)}); console.log('loaded'); }
    catch(error) { console.log(error.code); }
  `,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(native).toBe(
      request === "./nested" ? "ERR_UNSUPPORTED_DIR_IMPORT" : "ERR_MODULE_NOT_FOUND",
    );
    expect(
      createNodeModuleResolver({ kind: "esm" }).resolve(request, project.importer),
    ).toMatchObject({ kind: "unresolved" });
  },
);
