import { describe, expect, it } from "vite-plus/test";
import { getTriggerCertainty } from "../conformance/verifier/score";
import type { Action } from "../conformance/verifier/types";

const clickTidy: Action = {
  key: "click:button:Tidy",
  kind: "click",
  tag: "button",
  label: "Tidy",
  isInChild: false,
  clickAncestors: [],
};

describe("trigger certainty", () => {
  it("is sure when the handler's element has the clicked text", () => {
    expect(getTriggerCertainty({ tag: "button", text: "Tidy", event: "onClick" }, clickTidy)).toBe(
      "sure",
    );
  });

  it("is only maybe when the handler's element has no text to tell it apart", () => {
    expect(getTriggerCertainty({ tag: "button", text: null, event: "onClick" }, clickTidy)).toBe(
      "maybe",
    );
  });
});
