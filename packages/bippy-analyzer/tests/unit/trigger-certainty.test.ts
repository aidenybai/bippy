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

  it("matches a long label the browser truncated and joined without spaces", () => {
    const clickOverlay: Action = {
      ...clickTidy,
      key: "click:div:UPI QR CodeScan this QR code to make a U",
      tag: "div",
      label: "UPI QR CodeScan this QR code to make a U",
    };
    expect(
      getTriggerCertainty(
        {
          tag: "div",
          text: "UPI QR Code Scan this QR code to make a UPI payment",
          event: "onClick",
        },
        clickOverlay,
      ),
    ).toBe("sure");
  });
});
