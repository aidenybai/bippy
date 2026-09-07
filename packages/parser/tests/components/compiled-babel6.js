import * as React from "react";

var _createClass = (function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }
  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
})();

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }
  return call && (typeof call === "object" || typeof call === "function") ? call : self;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError(
      "Super expression must either be null or a function, not " + typeof superClass,
    );
  }
  subClass.prototype = Object.create(superClass && superClass.prototype, {
    constructor: { value: subClass, enumerable: false, writable: true, configurable: true },
  });
  if (superClass)
    Object.setPrototypeOf
      ? Object.setPrototypeOf(subClass, superClass)
      : (subClass.__proto__ = superClass);
}

/** Babel 6 spec mode as shipped by react-modal: `_possibleConstructorReturn` over `(Class.__proto__ || Object.getPrototypeOf(Class)).call`. */
var Portal = (function (_Component) {
  _inherits(Portal, _Component);

  function Portal(props) {
    _classCallCheck(this, Portal);

    var _this = _possibleConstructorReturn(
      this,
      (Portal.__proto__ || Object.getPrototypeOf(Portal)).call(this, props),
    );

    _this.shouldBeClosed = function () {
      return !_this.state.isOpen && !_this.state.beforeClose;
    };

    _this.buildClassName = function (which) {
      return "Portal__" + which;
    };

    _this.state = {
      afterOpen: false,
      beforeClose: false,
      isOpen: false,
    };
    return _this;
  }

  _createClass(Portal, [
    {
      key: "render",
      value: function render() {
        if (this.shouldBeClosed()) {
          return null;
        }
        return React.createElement(
          "div",
          { className: this.buildClassName("overlay") },
          this.props.children,
        );
      },
    },
  ]);

  return Portal;
})(React.Component);

export default function App() {
  return React.createElement(
    "main",
    null,
    React.createElement(Portal, null, React.createElement("p", null, "hidden while closed")),
    React.createElement("span", null, "visible"),
  );
}
