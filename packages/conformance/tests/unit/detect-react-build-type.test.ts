import { describe, expect, it } from "vite-plus/test";
import {
  detectReactBuildType,
  ReactBuildType,
  type ReactRenderer,
} from "../../../bippy/src/index.js";

const createRenderer = (bundleType: number): ReactRenderer => ({
  bundleType,
  rendererPackageName: "test-renderer",
  version: "19.2.0",
});

describe("detectReactBuildType", () => {
  it("recognizes production renderers", () => {
    expect(detectReactBuildType(createRenderer(ReactBuildType.Production))).toBe("production");
  });

  it("recognizes development and future non-production renderers", () => {
    expect(detectReactBuildType(createRenderer(ReactBuildType.Development))).toBe("development");
    expect(detectReactBuildType(createRenderer(2))).toBe("development");
  });
});
