import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite-plus";
import { expect, it } from "vitest";
import { createConcreteRuntime } from "../src/index.js";

it("executes native-built entry and dynamic chunks with live exports, singleton identity, and top-level await", async () => {
  const result = await build({
    root: fileURLToPath(new URL("./fixtures/modules/", import.meta.url)),
    configFile: false,
    envFile: false,
    logLevel: "silent",
    build: {
      target: "esnext",
      write: false,
      minify: false,
      sourcemap: true,
      lib: {
        entry: fileURLToPath(new URL("./fixtures/modules/entry.ts", import.meta.url)),
        formats: ["es"],
        fileName: "entry",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  expect(outputs).toHaveLength(1);
  const output = outputs[0];
  if (!("output" in output)) throw new Error("Unexpected native build output");
  const chunks = output.output.filter((item) => item.type === "chunk");
  expect(chunks).toHaveLength(3);
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("Missing selected module entry");
  expect(entry.dynamicImports).toHaveLength(1);
  await using resources = new AsyncDisposableStack();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "bippy-concrete-modules-"));
  resources.defer(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const directory = await realpath(temporaryDirectory);
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  const modules = [];
  for (const chunk of chunks) {
    expect(chunk.map === null).toBe(entry.dynamicImports.includes(chunk.fileName));
    const filename = join(directory, chunk.fileName);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, chunk.code);
    modules.push({ specifier: pathToFileURL(filename).href, source: chunk.code });
  }
  const entryUrl = pathToFileURL(join(directory, entry.fileName)).href;
  const source = `
    const entry = await import(${JSON.stringify(entryUrl)});
    const before = entry.observe();
    entry.increment();
    const same = await entry.load();
    globalThis.observation = JSON.stringify({ before, same, after: entry.observe() });
  `;
  const native = execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", `${source}\nconsole.log(observation);`],
    { encoding: "utf8", timeout: 10_000 },
  ).trim();
  const runtime = await createConcreteRuntime({ modules });
  try {
    runtime.evaluate(`(async () => { ${source} })()`);
    runtime.drainJobs();
    expect(runtime.readString("observation")).toBe(native);
    expect(JSON.parse(native)).toEqual({
      before: { count: 0, same: true, url: entryUrl },
      same: true,
      after: { count: 2, same: true, url: entryUrl },
    });
  } finally {
    runtime.dispose();
  }
});

it("lets engine262 link cycles, preserve live bindings, and cache URL aliases", async () => {
  const runtime = await createConcreteRuntime({
    modules: [
      {
        specifier: "https://fixture.invalid/first.js",
        source: `import { read } from './second.js'; export let count = 0; export const increment = () => count++; export const observe = () => read();`,
      },
      {
        specifier: "https://fixture.invalid/second.js",
        source: `import { count } from './first.js'; export const read = () => count;`,
      },
    ],
  });
  try {
    runtime.evaluate(
      `
      import('./first.js').then(async (first) => {
        const alias = await import('./directory/../first.js');
        first.increment();
        globalThis.result = JSON.stringify([first === alias, first.observe(), alias.count]);
      });
    `,
      "https://fixture.invalid/main.js",
    );
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe("[true,1,1]");
  } finally {
    runtime.dispose();
  }
});

it("retains import errors and caches evaluation failures without rerunning effects", async () => {
  const runtime = await createConcreteRuntime({
    modules: [
      {
        specifier: "https://fixture.invalid/fail.js",
        source: `globalThis.runs++; throw new Error('module failed');`,
      },
    ],
  });
  try {
    runtime.evaluate(`
      globalThis.runs = 0;
      (async () => {
        let first;
        try { await import('https://fixture.invalid/fail.js'); } catch (error) { first = error; }
        try { await import('https://fixture.invalid/fail.js'); } catch (error) {
          globalThis.result = JSON.stringify([first === error, runs, error.name, error.message]);
        }
      })();
    `);
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe('[true,1,"Error","module failed"]');
  } finally {
    runtime.dispose();
  }
});

it.each(["https://fixture.invalid/missing.js", "react", "./without-referrer.js", "node:fs"])(
  "does not guess or fetch missing artifacts: %s",
  async (specifier) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(
        `import(${JSON.stringify(specifier)}).catch(error => { globalThis.message = error.message; });`,
      );
      runtime.drainJobs();
      expect(runtime.readString("message")).toContain("Cannot load module");
    } finally {
      runtime.dispose();
    }
  },
);

it.each([
  [{ specifier: "./relative.js", source: "" }],
  [{ specifier: "https://fixture.invalid/directory/../entry.js", source: "" }],
  [
    { specifier: "https://fixture.invalid/entry.js", source: "" },
    { specifier: "https://fixture.invalid/entry.js", source: "" },
  ],
])("rejects ambiguous module identities: %j", async (...modules) => {
  await expect(createConcreteRuntime({ modules })).rejects.toThrow(
    /absolute URLs|canonical and unique/,
  );
});

it("snapshots supplied sources before asynchronous engine loading", async () => {
  const modules = [
    { specifier: "https://fixture.invalid/entry.js", source: `export const value = 'original';` },
  ];
  const pending = createConcreteRuntime({ modules });
  modules[0].source = "throw 'mutated'";
  modules.length = 0;
  const runtime = await pending;
  try {
    runtime.evaluate(
      `import('https://fixture.invalid/entry.js').then(module => { globalThis.result = module.value; });`,
    );
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe("original");
  } finally {
    runtime.dispose();
  }
});
