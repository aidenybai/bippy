import { describe, expect, it } from "vite-plus/test";
import { getErrorChain } from "../conformance/verifier/reasons";

describe("error chain", () => {
  it("names each cause after the error it explains", () => {
    const socketError = new Error("other side closed");
    const fetchError = new TypeError("fetch failed", { cause: socketError });
    const stageError = new Error("analysis failed after 92 min", { cause: fetchError });
    expect(getErrorChain(stageError)).toBe(
      "analysis failed after 92 min: fetch failed: other side closed",
    );
  });

  it("reports an error without a cause as its message", () => {
    expect(getErrorChain(new Error("setup failed"))).toBe("setup failed");
  });
});
