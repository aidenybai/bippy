import { describe, expect, it } from "vite-plus/test";
import { loadAsset, resolveAssetId } from "../conformance/verifier/harness/assets";
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
