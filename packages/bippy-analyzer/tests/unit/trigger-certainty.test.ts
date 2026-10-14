import { describe, expect, it } from "vite-plus/test";
import { getHandlerCertainty, getTriggerCertainty } from "../conformance/verifier/score";
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

  it("only maybe matches a long label the browser truncated, since others may share it", () => {
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
    ).toBe("maybe");
  });

  it("uses the strongest match among every element sharing a handler", () => {
    const toggleMenu: Action = {
      ...clickTidy,
      key: "click:button:Toggle menu",
      label: "Toggle menu",
    };
    expect(
      getHandlerCertainty(
        [
          { tag: "a", text: "Docs", event: "onClick" },
          { tag: "button", text: "Toggle menu", event: "onClick" },
        ],
        toggleMenu,
      ),
    ).toBe("sure");
  });
});
