import "../../../bippy/src/install-hook-only.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { SourceTextModule, SyntheticModule, type Module } from "node:vm";
import { transformSync } from "esbuild";
import { createCommitRecorder } from "../../src/harness/commit-recorder.js";
import { getRootContainer } from "../../src/harness/runtime-snapshot.js";
import { ensureDomGlobals } from "../../src/materialize/dom-environment.js";

const requireDependency = createRequire(import.meta.url);
const modules = new Map<string, Module>();

const loadModule = (filename: string): Module => {
  const cached = modules.get(filename);
  if (cached) return cached;
  const source = transformSync(readFileSync(filename, "utf8"), {
    loader: extname(filename) === ".tsx" ? "tsx" : "ts",
    jsx: "automatic",
    target: "esnext",
  }).code;
  const module = new SourceTextModule(source, { identifier: filename });
  modules.set(filename, module);
  return module;
};

const resolveModule = (specifier: string, referringModule: Module): Module => {
  if (specifier.startsWith(".")) {
    const filename = resolve(dirname(referringModule.identifier), specifier);
    const resolved = [filename, `${filename}.ts`, `${filename}.tsx`].find(existsSync);
    if (!resolved) throw new Error(`Missing module ${filename}`);
    return loadModule(resolved);
  }
  const filename = requireDependency.resolve(specifier);
  const cached = modules.get(filename);
  if (cached) return cached;
  const exports = requireDependency(specifier);
  const names = Object.keys(exports);
  const module = new SyntheticModule(
    names,
    () => {
      for (const name of names) module.setExport(name, exports[name]);
    },
    { identifier: filename },
  );
  modules.set(filename, module);
  return module;
};

const main = async (): Promise<void> => {
  ensureDomGlobals();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const module = loadModule(process.argv[2]);
  await module.link(resolveModule);
  await module.evaluate();
  const component = Reflect.get(module.namespace, "default");
  if (typeof component !== "function") throw new Error("Missing component default export");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const recorder = createCommitRecorder({
    rootFilter: (root) => getRootContainer(root) === container,
  });
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(component)));
    writeFileSync(process.argv[3], JSON.stringify(recorder.snapshot()), { flag: "wx" });
  } finally {
    await act(async () => root.unmount());
    recorder.dispose();
    container.remove();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
