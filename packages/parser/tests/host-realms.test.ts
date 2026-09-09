import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { HostPlatform } from "../src/host/host-realm.js";
import { createStaticRenderer } from "../src/index.js";
import { describeValue } from "../src/evaluate/values.js";
import type { RenderEnvironment, StaticValue } from "../src/types.js";

interface EvaluatedExports {
  [exportName: string]: string;
}

interface EvaluationOptions {
  hostPlatform?: HostPlatform;
  environment?: RenderEnvironment;
}

/** Each export must be a zero-argument function; its call result is described. */
const evaluateExports = async (
  source: string,
  { hostPlatform, environment }: EvaluationOptions = {},
): Promise<EvaluatedExports> => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-parser-host-realms-"));
  mkdirSync(path.join(rootDirectory, "src"));
  writeFileSync(path.join(rootDirectory, "package.json"), '{"name":"host-realms","type":"module"}');
  const entryPath = path.join(rootDirectory, "src/probe.ts");
  writeFileSync(entryPath, source);
  const renderer = createStaticRenderer({ rootDirectory, hostPlatform });
  const described: EvaluatedExports = {};
  await renderer.renderWith((interpreter) => {
    const module = renderer.loadModule(entryPath);
    if (module === null) throw new Error(`could not load ${entryPath}`);
    const context = interpreter.createModuleContext(module, undefined, environment ?? null);
    for (const entry of module.exports) {
      if (entry.kind !== "local") continue;
      const callee = interpreter.evaluateModuleExport(module, entry.exportedName);
      const result: StaticValue = interpreter.callValue(callee, [], context, null);
      described[entry.exportedName] = describeValue(result);
    }
    return { kind: "primitive", value: null };
  });
  return described;
};

const PROBE = `
export const windowType = () => typeof window;
export const documentType = () => typeof document;
export const globalThisType = () => typeof globalThis;
export const processType = () => typeof process;
export const hasProcess = () => typeof process !== "undefined";
export const nodeEnv = () => process.env.NODE_ENV;
export const bufferType = () => typeof Buffer;
export const fetchType = () => typeof fetch;
export const navigatorProduct = () => navigator.product;
export const mathMax = () => Math.max(1, 2);
export const documentInWindow = () => "document" in window;
export const processInGlobal = () => "process" in globalThis;
export const globalProcessType = () => typeof globalThis.process;
export const windowBufferType = () => typeof window.Buffer;
export const globalMapType = () => typeof globalThis.Map;
export const readDocument = () => document;
export const windowDocumentBody = () => window.document.body;
export const selfLocation = () => typeof self.location;
export const consoleLog = () => typeof console.log;
export const createdTagName = () => document.createElement("div").tagName;
export const createdIsNode = () => document.createElement("span") instanceof Node;
export const documentContainsBody = () => document.contains(document.body);
`;

describe("host realms in the interpreter", () => {
  it("evaluates browser globals from the DOM declarations", async () => {
    const values = await evaluateExports(PROBE);
    expect(values.windowType).toBe('"object"');
    expect(values.documentType).toBe('"object"');
    expect(values.globalThisType).toBe('"object"');
    expect(values.mathMax).toBe("2");
    expect(values.documentInWindow).toBe("true");
    expect(values.windowDocumentBody).toBe("native HTMLBodyElement");
    expect(values.selfLocation).toBe('"object"');
    expect(values.consoleLog).toBe('"function"');
    expect(values.fetchType).toBe('"function"');
  });

  it("serves document members from the renderer's document in the browser", async () => {
    const values = await evaluateExports(PROBE);
    expect(values.createdTagName).toBe('"DIV"');
    expect(values.createdIsNode).toBe("true");
    expect(values.documentContainsBody).toBe("true");
  });

  it("keeps the renderer's document away from hosts without one", async () => {
    const node = await evaluateExports(PROBE, { hostPlatform: "node" });
    expect(node.documentType).toBe('"undefined"');
    expect(node.createdTagName).toContain("unknown");
    const reactNative = await evaluateExports(PROBE, { hostPlatform: "react-native" });
    expect(reactNative.createdIsNode).toContain("unknown");
    expect(reactNative.windowDocumentBody).toContain("unknown");
  });

  it("leaves bundler-polyfilled Node objects open in the browser", async () => {
    const values = await evaluateExports(PROBE);
    expect(values.processType).toContain("typeof");
    expect(values.hasProcess).toContain("boolean");
    expect(values.nodeEnv).toBe('"development"');
    expect(values.bufferType).toContain("typeof");
    expect(values.processInGlobal).toBe("false");
  });

  it("reads bundler-provided names as free identifiers only, not global object properties", async () => {
    const values = await evaluateExports(PROBE);
    expect(values.globalProcessType).toBe('"undefined"');
    expect(values.windowBufferType).toBe('"undefined"');
    expect(values.globalMapType).toBe('"function"');
  });

  it("makes browser globals undefined on the server", async () => {
    const values = await evaluateExports(PROBE, { environment: "server" });
    expect(values.windowType).toBe('"undefined"');
    expect(values.documentType).toBe('"undefined"');
    expect(values.processType).toBe('"object"');
    expect(values.nodeEnv).toBe('"development"');
    expect(values.readDocument).toBe("unknown(`document` is not defined)");
    expect(values.processInGlobal).toBe("true");
    expect(values.globalProcessType).toBe('"object"');
  });

  it("makes browser globals undefined in React Native without a document", async () => {
    const values = await evaluateExports(PROBE, { hostPlatform: "react-native" });
    expect(values.windowType).toBe('"object"');
    expect(values.documentType).toBe('"undefined"');
    expect(values.readDocument).toBe("unknown(`document` is not defined)");
    expect(values.documentInWindow).toBe("false");
    expect(values.navigatorProduct).toContain("string");
    expect(values.fetchType).toBe('"function"');
  });

  it("keeps the ECMAScript host free of every embedding's globals", async () => {
    const values = await evaluateExports(PROBE, { hostPlatform: "ecmascript" });
    expect(values.windowType).toBe('"undefined"');
    expect(values.documentType).toBe('"undefined"');
    expect(values.fetchType).toBe('"undefined"');
    expect(values.globalThisType).toBe('"object"');
    expect(values.mathMax).toBe("2");
  });
});
