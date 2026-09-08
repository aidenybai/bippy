import * as React from "react";

function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  subClass.__proto__ = superClass;
}

function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}

function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  return Constructor;
}

var __extends = function (d, b) {
  Object.setPrototypeOf(d, b);
  d.prototype = Object.create(b.prototype);
  d.prototype.constructor = d;
};

/** Babel loose mode: `_inheritsLoose`, a `_proto` alias and constructor-assigned fields. */
var Greeting = /*#__PURE__*/ (function (_React$Component) {
  _inheritsLoose(Greeting, _React$Component);
  function Greeting(props) {
    var _this;
    _this = _React$Component.call(this, props) || this;
    _this.state = { count: 0 };
    _this.renderBadge = function () {
      return React.createElement("small", null, "badge");
    };
    return _this;
  }
  var _proto = Greeting.prototype;
  _proto.render = function render() {
    return React.createElement(
      "div",
      null,
      React.createElement("h1", null, this.props.title),
      this.renderBadge(),
    );
  };
  return Greeting;
})(React.Component);
Greeting.defaultProps = { title: "hello" };

/** Babel spec mode: `_createClass` descriptor lists, with a static error boundary member. */
var Boundary = /*#__PURE__*/ (function (_Component) {
  _inheritsLoose(Boundary, _Component);
  function Boundary() {
    return _Component.apply(this, arguments) || this;
  }
  _createClass(
    Boundary,
    [
      {
        key: "render",
        value: function render() {
          return React.createElement("section", null, this.props.children);
        },
      },
    ],
    [
      {
        key: "getDerivedStateFromError",
        value: function getDerivedStateFromError() {
          return {};
        },
      },
    ],
  );
  return Boundary;
})(React.Component);

/** TypeScript: `__extends`, prototype assignments and a static inside the wrapper. */
var Counter = /** @class */ (function (_super) {
  __extends(Counter, _super);
  function Counter() {
    return (_super !== null && _super.apply(this, arguments)) || this;
  }
  Counter.prototype.render = function () {
    return React.createElement("p", null, "count: ", String(this.props.count));
  };
  Counter.defaultProps = { count: 1 };
  return Counter;
})(React.PureComponent);

/** Minified loose mode: `_inheritsLoose` inlined into the wrapper's `return a = b, (t = n).prototype = …, n` sequence. */
var withBadge = function (e) {
  return (function (r) {
    var t, i;
    function n() {
      return r.apply(this, arguments) || this;
    }
    return (
      (i = r),
      ((t = n).prototype = Object.create(i.prototype)),
      (t.prototype.constructor = t),
      Object.setPrototypeOf(t, i),
      (n.prototype.render = function () {
        var r = this.props,
          label = r.label;
        return React.createElement(
          "div",
          null,
          React.createElement(e, { label: label + "!" }),
          React.createElement("small", null, "badge"),
        );
      }),
      n
    );
  })(React.Component);
};
var Label = function (props) {
  return React.createElement("span", null, props.label);
};
var BadgedLabel = withBadge(Label);

export default function CompiledClasses() {
  return React.createElement(
    Boundary,
    null,
    React.createElement(Greeting, null),
    React.createElement(Counter, { count: 2 }),
    React.createElement(BadgedLabel, { label: "hi" }),
  );
}
