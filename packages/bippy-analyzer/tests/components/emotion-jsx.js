// Output of `@jsxImportSource @emotion/react` (jsx-runtime) and the classic
// `jsx` pragma: props with an own `css` key swap the element for Emotion's
// EmotionCssPropInternal wrapper, other props go straight to React. The babel
// plugin also rewrites `styled.tag` into `@emotion/styled/base` calls carrying
// the label and target it computed.
import _styled from "@emotion/styled/base";
import { jsx } from "@emotion/react";
import { jsx as _jsx, jsxs as _jsxs } from "@emotion/react/jsx-runtime";

const Banner = /*#__PURE__*/ _styled("header", { target: "e1x2y3z0", label: "Banner" })({
  name: "1abc",
  styles: "padding:8px",
});

const accent = { color: "tomato" };

const Plain = function Plain() {
  return /*#__PURE__*/ _jsx("em", { children: "plain" });
};

const Styled = function Styled() {
  return /*#__PURE__*/ _jsxs("strong", {
    css: accent,
    children: [
      "styled",
      /*#__PURE__*/ _jsx("i", { css: { fontStyle: "italic" }, children: "nested" }),
    ],
  });
};

const Classic = function Classic() {
  return jsx(
    "section",
    { css: accent },
    jsx("b", null, "classic"),
    jsx("u", { css: undefined }, "u"),
  );
};

const Undecided = function Undecided() {
  const extra = window.location.hash === "#accent" ? { css: accent } : {};
  return /*#__PURE__*/ _jsx("span", Object.assign({}, extra, { children: "maybe" }));
};

export default function EmotionJsx() {
  return /*#__PURE__*/ _jsxs("div", {
    children: [
      /*#__PURE__*/ _jsx(Plain, {}),
      /*#__PURE__*/ _jsx(Styled, {}),
      /*#__PURE__*/ _jsx(Classic, {}),
      /*#__PURE__*/ _jsx(Undecided, {}),
      /*#__PURE__*/ _jsx(Banner, { children: "labeled" }),
    ],
  });
}
