import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";

const writePackage = (rootDirectory: string, name: string, source: string): void => {
  const directory = path.join(rootDirectory, "node_modules", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name, version: "16.14.0", main: "index.js" }),
  );
  writeFileSync(path.join(directory, "index.js"), source);
};

describe("react runtime", () => {
  it("falls back to the harness React when the app's react-dom has no client entry", async () => {
    const harnessReactDom = path.dirname(require.resolve("react-dom/package.json"));
    const rootDirectory = mkdtempSync(path.join(import.meta.dirname, "..", ".tmp-react-16-"));
    try {
      writePackage(
        rootDirectory,
        "react",
        `module.exports = { version: "16.14.0", createElement() {}, createContext() {}, Component: class {} };`,
      );
      writePackage(
        rootDirectory,
        "react-dom",
        `module.exports = { version: "16.14.0", createPortal() {}, render() {} };`,
      );
      const resolver = new ModuleResolver({ rootDirectory });
      const client = resolver.resolve("react-dom/client", `${rootDirectory}/index.js`);
      expect(client.kind === "external" ? client.filePath : null).toBe(
        path.join(harnessReactDom, "client.js"),
      );

      const runtime = await loadReactRuntime({ resolver, rootDirectory });
      const harnessReact = await import("react");

      expect(runtime.react.version).toBe(harnessReact.version);
      expect(runtime.react.version).not.toBe("16.14.0");
      expect(runtime.dom.version).toBe(harnessReact.version);
      expect(typeof runtime.domClient.createRoot).toBe("function");
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
