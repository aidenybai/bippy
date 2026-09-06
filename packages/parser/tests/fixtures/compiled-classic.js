import * as React from "react";

function _extends() {
  _extends = Object.assign
    ? Object.assign.bind()
    : function (target) {
        for (var i = 1; i < arguments.length; i++) {
          var source = arguments[i];
          for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              target[key] = source[key];
            }
          }
        }
        return target;
      };
  return _extends.apply(this, arguments);
}

var Badge = function Badge(props) {
  return React.createElement("span", _extends({}, props, { className: "badge" }), props.count);
};

var Panel = /*#__PURE__*/ (function () {
  function Panel(_ref) {
    var title = _ref.title,
      children = _ref.children,
      rest = _objectWithoutProperties(_ref, ["title", "children"]);
    return React.createElement(
      "section",
      _extends({}, rest),
      React.createElement("h3", null, title),
      children,
    );
  }
  Panel.displayName = "Panel";
  return Panel;
})();

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};
  var target = {};
  for (var key in source) {
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
}

var Memoized = /*#__PURE__*/ React.memo(function Memoized(_ref) {
  var value = _ref.value;
  return React.createElement("code", null, value);
});

export default function CompiledClassic() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Badge, { count: 3, title: "count" }),
    React.createElement(
      Panel,
      { title: "panel" },
      React.createElement(Memoized, { value: "memo" }),
      React.createElement(React.StrictMode, null, React.createElement("hr", null)),
    ),
  );
}
