import { describe, expect, it } from "vite-plus/test";
import { loadAsset, resolveAssetId, toWorkerImport } from "../conformance/verifier/harness/assets";
import { IMAGE_FILE_PATTERN } from "../conformance/verifier/harness/packages";

describe("svg component imports", () => {
  it("serves a plain .svg import as a component when the app uses SVGR", () => {
    const id = resolveAssetId("../icons/close.svg", "/app/components/modal.tsx", true);
    expect(id).not.toBeNull();
    expect(IMAGE_FILE_PATTERN.test(id ?? "")).toBe(false);
    expect(loadAsset(id ?? "")).toContain("export default function SvgComponent");
  });

  it("leaves a plain .svg import to Vite when the app doesn't use SVGR", () => {
    expect(resolveAssetId("/icons/close.svg", "/app/components/modal.tsx", false)).toBeNull();
  });
});

describe("virtual asset ids", () => {
  it("keeps parent directory segments out of a stylesheet stand-in's id", () => {
    const id = resolveAssetId("../../css/docs-overview.css", "/app/src/components/a.jsx", false);
    expect(id?.split("/")).not.toContain("..");
    expect(loadAsset(id ?? "")).toContain("new Proxy");
  });
});

describe("html template imports", () => {
  it("serves a relative .html import as its text, as html-loader does", () => {
    const id = resolveAssetId("./dialog.template.html", "/app/src/components/dialog.js", false);
    expect(id).not.toBeNull();
    expect(loadAsset(id ?? "")).toBe('export default "";');
  });
});

describe("stylesheet stand-ins", () => {
  it("maps class names to themselves and still converts to a string", async () => {
    const id = resolveAssetId("./button.module.css", "/app/src/button.tsx", false);
    const source = loadAsset(id ?? "") ?? "";
    const stylesheet: unknown = (await import(`data:text/javascript,${encodeURIComponent(source)}`))
      .default;
    expect(Reflect.get(Object(stylesheet), "primaryButton")).toBe("primaryButton");
    expect(String(stylesheet)).toBe("[object Object]");
  });
});

describe("worker-loader imports", () => {
  it("loads a relative .worker file as a worker constructor", () => {
    expect(toWorkerImport("./blurhash.worker.ts")).toBe("./blurhash.worker.ts?worker");
  });

  it("leaves other imports and already-queried workers alone", () => {
    expect(toWorkerImport("./blurhash.ts")).toBeNull();
    expect(toWorkerImport("./blurhash.worker.ts?worker")).toBeNull();
    expect(toWorkerImport("blurhash-worker")).toBeNull();
  });
});
