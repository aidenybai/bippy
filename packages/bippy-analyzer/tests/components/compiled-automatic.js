import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";

var Row = function Row(_ref) {
  var label = _ref.label,
    _ref$isActive = _ref.isActive,
    isActive = _ref$isActive === void 0 ? false : _ref$isActive;
  return /*#__PURE__*/ _jsxs("li", {
    className: isActive ? "active" : undefined,
    children: [
      label,
      isActive &&
        /*#__PURE__*/ _jsx("em", {
          children: "current",
        }),
    ],
  });
};

function Toggle() {
  var _useState = useState(false),
    isOpen = _useState[0],
    setOpen = _useState[1];
  return /*#__PURE__*/ _jsxs(_Fragment, {
    children: [
      /*#__PURE__*/ _jsx("button", {
        onClick: function onClick() {
          return setOpen(!isOpen);
        },
        children: "toggle",
      }),
      isOpen ? /*#__PURE__*/ _jsx("p", { children: "open" }) : null,
    ],
  });
}

var ITEMS = ["one", "two"];

export default function CompiledAutomatic() {
  return /*#__PURE__*/ _jsxs("div", {
    children: [
      /*#__PURE__*/ _jsx("ul", {
        children: ITEMS.map(function (item, index) {
          return /*#__PURE__*/ _jsx(
            Row,
            {
              label: item,
              isActive: index === 0,
            },
            item,
          );
        }),
      }),
      /*#__PURE__*/ _jsx(Toggle, {}),
    ],
  });
}
