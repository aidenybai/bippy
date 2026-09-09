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
export const readDocument = () => document;
export const windowDocumentBody = () => window.document.body;
export const selfLocation = () => typeof self.location;
export const consoleLog = () => typeof console.log;
export const createdTagName = () => document.createElement("div").tagName;
export const createdIsNode = () => document.createElement("span") instanceof Node;
export const documentContainsBody = () => document.contains(document.body);
`;

const MEMBER_PROBE = `
export const query = () => document.querySelector("#root");
export const queryAllLength = () => document.querySelectorAll(".x").length;
export const boundingWidth = () => document.body.getBoundingClientRect().width;
export const offsetWidth = () => document.body.offsetWidth;
export const canvasContext = () => document.createElement("canvas").getContext("2d");
export const undeclaredDocumentMember = () => document.notAMember;
export const undeclaredWindowMember = () => window.notAMember;
export const titleType = () => typeof document.title;
export const hidden = () => document.hidden;
export const requestFrameType = () => typeof window.requestAnimationFrame;
export const userAgentType = () => typeof navigator.userAgent;
export const userAgent = () => navigator.userAgent;
export const language = () => navigator.language;
export const sendBeaconType = () => typeof navigator.sendBeacon;
export const filledFirst = () => [1, 2].fill(0)[0];
export const listenerCount = () => {
  let count = 0;
  window.addEventListener("resize", () => count++);
  document.addEventListener("visibilitychange", () => count++);
  return count;
};
`;

const INTRINSIC_PROBE = `
export const arrowIsFunction = () => (() => 1) instanceof Function;
export const objectIsFunction = () => ({}) instanceof Function;
export const arrayIsObject = () => [1] instanceof Object;
export const mapIsMap = () => new Map() instanceof Map;
export const urlIsUrl = () => new URL("https://example.test/") instanceof URL;
export const symbolIsSymbol = () => Symbol.iterator instanceof Symbol;
export const functionProto = () => Object.getPrototypeOf(() => 1) === Function.prototype;
export const functionProtoProto = () => Object.getPrototypeOf(Function.prototype) === Object.prototype;
export const arrayProto = () => Object.getPrototypeOf([]) === Array.prototype;
export const symbolLength = () => Symbol.length;
`;

describe("language intrinsics in the interpreter", () => {
  it("answers instanceof and prototype identity for every shared ECMAScript and host constructor", async () => {
    const values = await evaluateExports(INTRINSIC_PROBE);
    expect(values.arrowIsFunction).toBe("true");
    expect(values.objectIsFunction).toBe("false");
    expect(values.arrayIsObject).toBe("true");
    expect(values.mapIsMap).toBe("true");
    expect(values.urlIsUrl).toBe("true");
    expect(values.symbolIsSymbol).toBe("false");
    expect(values.functionProto).toBe("true");
    expect(values.functionProtoProto).toBe("true");
    expect(values.arrayProto).toBe("true");
    expect(values.symbolLength).toBe("0");
  });
});

describe("host members in the interpreter", () => {
  it("answers declared document and window members from lib.dom and the static document", async () => {
    const values = await evaluateExports(MEMBER_PROBE);
    expect(values.query).toBe(
      "unknown(document.querySelector() finds nothing in the static document)",
    );
    expect(values.queryAllLength).toContain("unknown");
    expect(values.titleType).toBe('"string"');
    expect(values.requestFrameType).toBe('"function"');
    expect(values.hidden).toBe("<boolean: document.hidden>");
    expect(values.undeclaredDocumentMember).toBe("unknown(document.notAMember)");
    expect(values.undeclaredWindowMember).toBe("unknown(globalThis.notAMember)");
    expect(values.listenerCount).toBe("0");
  });

  it("keeps layout and raster results open on interfaces the declarations type as concrete", async () => {
    const values = await evaluateExports(MEMBER_PROBE);
    expect(values.boundingWidth).toBe(
      "unknown(HTMLBodyElement.getBoundingClientRect() depends on layout)",
    );
    expect(values.offsetWidth).toBe("<number: HTMLBodyElement.offsetWidth depends on layout>");
    expect(values.canvasContext).toBe(
      "unknown(HTMLCanvasElement.getContext() depends on rasterization)",
    );
  });

  it("types navigator members from the declarations without inventing their values", async () => {
    const values = await evaluateExports(MEMBER_PROBE);
    expect(values.userAgentType).toBe('"string"');
    expect(values.userAgent).toBe("<string: navigator.userAgent>");
    expect(values.language).toBe("<string: navigator.language>");
    expect(values.sendBeaconType).toBe('"function"');
  });

  it("lets an array method that takes elements produce them", async () => {
    const values = await evaluateExports(MEMBER_PROBE);
    expect(values.filledFirst).toBe("0");
  });
});

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

  it("makes browser globals undefined on the server", async () => {
    const values = await evaluateExports(PROBE, { environment: "server" });
    expect(values.windowType).toBe('"undefined"');
    expect(values.documentType).toBe('"undefined"');
    expect(values.processType).toBe('"object"');
    expect(values.nodeEnv).toBe('"development"');
    expect(values.readDocument).toBe("unknown(`document` is not defined)");
    expect(values.processInGlobal).toBe("true");
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
