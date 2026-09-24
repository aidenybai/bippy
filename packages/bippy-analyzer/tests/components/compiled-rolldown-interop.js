import { jsx } from "react/jsx-runtime";

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) =>
  function () {
    return (
      mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports
    );
  };
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function")
    for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
      key = keys[i];
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: ((k) => from[k]).bind(null, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
    }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, "default", { value: mod, enumerable: true })
      : target,
    mod,
  )
);

var require_defineProperty = __commonJS({
  "helpers/defineProperty.js"(exports, module) {
    function _defineProperty(e, r, t) {
      return (
        r in e
          ? Object.defineProperty(e, r, {
              value: t,
              enumerable: !0,
              configurable: !0,
              writable: !0,
            })
          : (e[r] = t),
        e
      );
    }
    ((module.exports = _defineProperty),
      (module.exports.__esModule = true),
      (module.exports["default"] = module.exports));
  },
});

var require_objectSpread2 = __commonJS({
  "helpers/objectSpread2.js"(exports, module) {
    var defineProperty = require_defineProperty();
    function ownKeys(e, r) {
      var t = Object.keys(e);
      if (Object.getOwnPropertySymbols) {
        var o = Object.getOwnPropertySymbols(e);
        (r &&
          (o = o.filter(function (r$1) {
            return Object.getOwnPropertyDescriptor(e, r$1).enumerable;
          })),
          t.push.apply(t, o));
      }
      return t;
    }
    function _objectSpread2(e) {
      for (var r = 1; r < arguments.length; r++) {
        var t = null != arguments[r] ? arguments[r] : {};
        r % 2
          ? ownKeys(Object(t), !0).forEach(function (r$1) {
              defineProperty(e, r$1, t[r$1]);
            })
          : Object.getOwnPropertyDescriptors
            ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t))
            : ownKeys(Object(t)).forEach(function (r$1) {
                Object.defineProperty(e, r$1, Object.getOwnPropertyDescriptor(t, r$1));
              });
      }
      return e;
    }
    ((module.exports = _objectSpread2),
      (module.exports.__esModule = true),
      (module.exports["default"] = module.exports));
  },
});

var import_objectSpread2 = __toESM(require_objectSpread2());

const withLabel = (Wrapped) => {
  const WithLabel = (props) =>
    jsx("section", {
      children: jsx(Wrapped, (0, import_objectSpread2.default)({}, props, { label: "wrapped" })),
    });
  WithLabel.displayName = `withLabel(${Wrapped.displayName ?? Wrapped.name})`;
  return WithLabel;
};

const Page = ({ Component, label }) =>
  jsx("main", { children: [jsx("h1", { children: label }, "title"), jsx(Component, {}, "body")] });

const Body = () => jsx("p", { children: "body" });

const LabeledPage = withLabel(Page);

const App = () => jsx(LabeledPage, { Component: Body });

export default App;
