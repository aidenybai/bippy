import * as React from "react";
import * as styled_components_1 from "styled-components";

// A tsc-built CommonJS library (mdsmirror) without `importHelpers` inlines its
// helpers as `(this && this.__x) || function` and reads styled-components
// through `__importDefault`, which keeps a namespace flagged `__esModule` and
// otherwise wraps it; a modeled package namespace must carry that flag so
// `.default.div` resolves to the styled factory.

var __rest =
  (this && this.__rest) ||
  function (s, e) {
    var t = {};
    for (var p in s)
      if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
          t[p[i]] = s[p[i]];
      }
    return t;
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };

const styled = __importDefault(styled_components_1);

const Flex = styled.default.div`
  display: flex;
  flex-direction: ${({ column }) => (column ? "column" : "row")};
`;

const Label = (0, styled.default)("span")`
  font-weight: 600;
`;

const Row = (props) => {
  const { title } = props,
    rest = __rest(props, ["title"]);
  return React.createElement(Flex, Object.assign({ column: true }, rest), title);
};

export const isExact = true;

export default function CompiledLibraryInterop() {
  return React.createElement(
    Row,
    { title: "interop", "data-kind": "row" },
    React.createElement(Label, null, "body"),
  );
}
