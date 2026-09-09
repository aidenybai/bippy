import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { HostDeclarationIndex, type HostRealmBuild } from "../src/host/declaration-index.js";
import { HostRealm, loadHostRealm } from "../src/host/host-realm.js";
import type { HostMember } from "../src/host/realm-table.js";

const require = createRequire(import.meta.url);

const TYPESCRIPT_LIB_DIRECTORY = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "lib",
);

interface DeclarationFixture {
  [relativePath: string]: string;
}

const buildFixture = (files: DeclarationFixture, entry: string): HostRealmBuild => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-parser-declarations-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  const index = new HostDeclarationIndex(TYPESCRIPT_LIB_DIRECTORY, rootDirectory);
  index.addFile(path.join(TYPESCRIPT_LIB_DIRECTORY, "lib.esnext.d.ts"));
  index.addFile(path.join(rootDirectory, entry));
  return index.build();
};

const getGlobal = (build: HostRealmBuild, name: string): HostMember | undefined =>
  new HostRealm("ecmascript", build.table).getGlobal(name) ?? undefined;

const gapsAt = (build: HostRealmBuild, site: string) =>
  build.gaps.filter((gap) => gap.site === site).map((gap) => gap.reason);

describe("host declaration index", () => {
  it("resolves Node's globalThis conditional to the merged global or the module fallback", () => {
    const build = buildFixture(
      {
        "globals.d.ts": `
          declare module "url" {
            class URL { href: string; }
            global {
              var URL: typeof globalThis extends { onmessage: any; URL: infer T } ? T : typeof _URL;
            }
            import _URL = URL;
          }
          declare module "web" {
            global {
              interface Storage { length: number; }
              var Storage: { prototype: Storage; new (): Storage };
              var localStorage: typeof globalThis extends { onmessage: any; Storage: infer T } ? T : never;
              var indexedDB: typeof globalThis extends { onmessage: any; indexedDB: infer T } ? T : never;
            }
          }
          declare var onmessage: (event: object) => void;
        `,
      },
      "globals.d.ts",
    );
    expect(getGlobal(build, "URL")).toEqual({
      type: { kind: "function", interfaceName: 'typeof "url".URL', isNullable: false },
      returnType: null,
      parameterNames: null,
      returnsReceiverItems: false,
    });
    expect(getGlobal(build, "URL.prototype.href")?.type.kind).toBe("string");
    expect(getGlobal(build, "localStorage")?.type).toEqual({
      kind: "function",
      interfaceName: "typeof Storage",
      isNullable: false,
    });
    expect(getGlobal(build, "indexedDB")?.type.kind).toBe("undefined");
    expect(gapsAt(build, "globalThis.URL")).toEqual([]);
    expect(gapsAt(build, "globalThis.localStorage")).toEqual([]);
  });

  it("looks type and value names up in separate declaration spaces", () => {
    const build = buildFixture(
      {
        "globals.d.ts": `
          import type { ErrorUtils } from "./error-utils";
          declare global {
            const ErrorUtils: ErrorUtils;
          }
        `,
        "error-utils.d.ts": `
          export interface ErrorUtils {
            getGlobalHandler: () => (error: unknown) => void;
          }
        `,
      },
      "globals.d.ts",
    );
    expect(getGlobal(build, "ErrorUtils")?.type.kind).toBe("object");
    expect(getGlobal(build, "ErrorUtils.getGlobalHandler")?.type.kind).toBe("function");
    expect(gapsAt(build, "globalThis.ErrorUtils")).toEqual([]);
  });

  it("follows imports, star re-exports, export = and namespace imports across modules", () => {
    const build = buildFixture(
      {
        "index.d.ts": `
          import * as streams from "./streams";
          import { Reader } from "./barrel";
          import legacy = require("./legacy");
          declare global {
            var reader: Reader;
            var makeStream: typeof streams.create;
            var legacyVersion: typeof legacy.version;
            var legacyName: typeof legacy;
          }
        `,
        "streams.d.ts": `export function create(): number;`,
        "barrel.d.ts": `export * from "./reader";`,
        "reader.d.ts": `export interface Reader { read(): string; }`,
        "legacy.d.ts": `
          declare namespace legacy { const version: string; }
          export = legacy;
        `,
      },
      "index.d.ts",
    );
    expect(getGlobal(build, "reader.read")).toEqual({
      type: { kind: "function", interfaceName: null, isNullable: false },
      returnType: { kind: "string", interfaceName: null, isNullable: false },
      parameterNames: [],
      returnsReceiverItems: false,
    });
    expect(getGlobal(build, "makeStream")?.type.kind).toBe("function");
    expect(getGlobal(build, "legacyVersion")?.type.kind).toBe("string");
    expect(getGlobal(build, "legacyName.version")?.type.kind).toBe("string");
  });

  it("splits classes into instance and static sides and resolves indexed access", () => {
    const build = buildFixture(
      {
        "classes.d.ts": `
          declare class Widget {
            static registry: Map<string, Widget>;
            size: number;
            render(): string;
          }
          interface Options { retries: number; label: string }
          declare var retries: Options["retries"];
          declare var widgetSize: Widget["size"];
        `,
      },
      "classes.d.ts",
    );
    expect(getGlobal(build, "Widget")?.type.kind).toBe("function");
    expect(getGlobal(build, "Widget.registry")?.type.interfaceName).toBe("Map");
    expect(getGlobal(build, "Widget.prototype.render")?.returnType?.kind).toBe("string");
    expect(getGlobal(build, "retries")?.type.kind).toBe("number");
    expect(getGlobal(build, "widgetSize")?.type.kind).toBe("number");
  });

  it("substitutes generic alias arguments and reports what stays open", () => {
    const build = buildFixture(
      {
        "generics.d.ts": `
          type Maybe<T> = T | null;
          type Handler<T> = (value: T) => void;
          type Point = { x: number; y: number };
          type Unwrap<T> = T extends Handler<infer U> ? U : never;
          declare var label: Maybe<string>;
          declare var onReady: Handler<number>;
          declare var origin: Point;
          declare var unwrapped: Unwrap<Handler<string>>;
          declare function identity<T>(value: T): T;
          declare var untyped;
        `,
      },
      "generics.d.ts",
    );
    expect(getGlobal(build, "label")?.type).toEqual({
      kind: "string",
      interfaceName: null,
      isNullable: true,
    });
    expect(getGlobal(build, "onReady")?.type.kind).toBe("function");
    expect(getGlobal(build, "origin.x")?.type.kind).toBe("number");
    expect(getGlobal(build, "unwrapped")?.type.kind).toBe("any");
    expect(gapsAt(build, "globalThis.unwrapped")).toEqual(["type-parameter"]);
    expect(getGlobal(build, "identity")?.returnType?.kind).toBe("any");
    expect(gapsAt(build, "globalThis.identity")).toEqual(["type-parameter"]);
    expect(gapsAt(build, "globalThis.untyped")).toEqual(["declared-any"]);
  });

  it("merges overload returns to their common ancestor and reports disagreement", () => {
    const build = buildFixture(
      {
        "overloads.d.ts": `
          interface Creator {
            create(tag: "a"): HTMLAnchorLike;
            create(tag: string): ElementLike;
            pick(): number;
            pick(flag: true): string;
          }
          interface ElementLike { tag: string }
          interface HTMLAnchorLike extends ElementLike { href: string }
          declare var creator: Creator;
          declare var maybeName: string | null | undefined;
        `,
      },
      "overloads.d.ts",
    );
    expect(getGlobal(build, "creator.create")?.returnType).toEqual({
      kind: "object",
      interfaceName: "ElementLike",
      isNullable: false,
    });
    expect(gapsAt(build, "Creator.create")).toEqual([]);
    expect(getGlobal(build, "creator.pick")?.returnType?.kind).toBe("any");
    expect(gapsAt(build, "Creator.pick")).toEqual(["overloads"]);
    expect(getGlobal(build, "maybeName")?.type).toEqual({
      kind: "string",
      interfaceName: null,
      isNullable: true,
    });
  });
});

describe("generated host realms", () => {
  it("gives each platform its own global object", () => {
    const browser = loadHostRealm("browser");
    const node = loadHostRealm("node");
    const reactNative = loadHostRealm("react-native");
    const ecmascript = loadHostRealm("ecmascript");

    expect(browser.getGlobalTypeof("window")).toBe("object");
    expect(browser.getGlobalTypeof("document.body")).toBe("object");
    expect(browser.isGlobalAlias("self")).toBe(true);
    expect(browser.normalizeGlobalName("window.self.document.cookie")).toBe("document.cookie");

    expect(node.getGlobalTypeof("window")).toBe("undefined");
    expect(node.getGlobalTypeof("document")).toBe("undefined");
    expect(node.getGlobalTypeof("process.env")).toBe("object");
    expect(node.getGlobalTypeof("URL")).toBe("function");
    expect(node.getGlobalTypeof("Headers")).toBe("function");
    expect(node.getGlobalTypeof("performance.now")).toBe("function");
    expect(node.isGlobalAlias("global")).toBe(true);

    expect(reactNative.getGlobalTypeof("document")).toBe("undefined");
    expect(reactNative.isGlobalAlias("window")).toBe(true);
    expect(reactNative.getGlobalTypeof("navigator.product")).toBe("string");
    expect(reactNative.getGlobalTypeof("__DEV__")).toBe("boolean");
    expect(reactNative.hasDocument).toBe(false);

    expect(ecmascript.getGlobalTypeof("window")).toBe("undefined");
    expect(ecmascript.getGlobalTypeof("setTimeout")).toBe("undefined");
    expect(ecmascript.getGlobalTypeof("Math.max")).toBe("function");
  });

  it("carries interface inheritance from the declarations", () => {
    const browser = loadHostRealm("browser");
    expect(browser.isSubtype("HTMLDivElement", "EventTarget")).toBe(true);
    expect(browser.isSubtype("Document", "HTMLElement")).toBe(false);
    expect(browser.getMember("HTMLDivElement", "addEventListener")?.type.kind).toBe("function");
  });

  it("enumerates each platform's globals from its global object interfaces", () => {
    expect(loadHostRealm("browser").getGlobalNames()).toEqual(
      expect.arrayContaining(["document", "window", "navigator", "Math", "fetch"]),
    );
    const reactNative = loadHostRealm("react-native").getGlobalNames();
    expect(reactNative).toContain("navigator");
    expect(reactNative).not.toContain("document");
    const ecmascript = loadHostRealm("ecmascript").getGlobalNames();
    expect(ecmascript).toEqual(expect.arrayContaining(["Math", "Array", "Promise", "Intl"]));
    expect(ecmascript).not.toContain("setTimeout");
  });

  it("summarizes method signatures: parameter names, return interface, receiver items", () => {
    const ecmascript = loadHostRealm("ecmascript");
    const filter = ecmascript.getMember("Array", "filter");
    expect(filter?.parameterNames).toEqual(["predicate", "thisArg"]);
    expect(filter?.returnType?.interfaceName).toBe("Array");
    expect(filter?.returnsReceiverItems).toBe(true);
    expect(ecmascript.getMember("Array", "map")?.returnsReceiverItems).toBe(false);
    expect(ecmascript.getMember("Array", "forEach")?.returnType?.kind).toBe("undefined");
    expect(ecmascript.getMember("Array", "some")?.returnType?.kind).toBe("boolean");
    expect(ecmascript.getMember("Array", "slice")?.parameterNames).toEqual(["start", "end"]);
    expect(ecmascript.getMember("Promise", "then")?.parameterNames).toEqual([
      "onfulfilled",
      "onrejected",
    ]);
    expect(ecmascript.getMember("Array", "length")).toMatchObject({
      type: { kind: "number" },
      returnType: null,
      parameterNames: null,
    });
  });

  it("keeps methods that take elements from standing for the receiver", () => {
    const ecmascript = loadHostRealm("ecmascript");
    for (const name of ["sort", "toSorted", "reverse", "slice"]) {
      expect(ecmascript.getMember("Array", name)?.returnsReceiverItems, name).toBe(true);
    }
    for (const name of ["fill", "with", "concat", "splice"]) {
      expect(ecmascript.getMember("Array", name)?.returnsReceiverItems, name).toBe(false);
    }
    expect(ecmascript.getMember("IteratorObject", "take")?.returnsReceiverItems).toBe(true);
  });

  it("derives which interface dispatches each DOM event from the event maps", () => {
    const browser = loadHostRealm("browser");
    expect(browser.isEventOfType("click", "MouseEvent")).toBe(true);
    expect(browser.isEventOfType("keydown", "KeyboardEvent")).toBe(true);
    expect(browser.isEventOfType("focus", "FocusEvent")).toBe(true);
    expect(browser.isEventOfType("resize", "MouseEvent")).toBe(false);
    expect(browser.isEventOfType("resize", "UIEvent")).toBe(true);
    expect(browser.isEventOfType("load", "UIEvent")).toBe(false);
    expect(browser.getEventTypes("my:event")).toEqual([]);
    expect(browser.getEventTypes("click").map((type) => type.interfaceName)).toContain(
      "PointerEvent",
    );
  });

  it("resolves document, window and navigator member kinds from lib.dom", () => {
    const browser = loadHostRealm("browser");
    expect(browser.getMember("Document", "querySelector")).toMatchObject({
      type: { kind: "function" },
      returnType: { interfaceName: "Element", isNullable: true },
      parameterNames: ["selectors"],
    });
    expect(browser.getMember("Document", "body")?.type.interfaceName).toBe("HTMLElement");
    expect(browser.getMember("Document", "notAMember")).toBeNull();
    expect(browser.getMember("Window", "innerWidth")?.type.kind).toBe("number");
    expect(browser.getMember("Window", "matchMedia")?.returnType?.interfaceName).toBe(
      "MediaQueryList",
    );
    expect(browser.getMember("Navigator", "userAgent")?.type.kind).toBe("string");
    expect(browser.getMember("Navigator", "clipboard")?.type.interfaceName).toBe("Clipboard");
    expect(browser.getGlobalTypeof("navigator.sendBeacon")).toBe("function");
  });
});
