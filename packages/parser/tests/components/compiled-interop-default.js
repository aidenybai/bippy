import * as React from "react";

// A rollup-built CommonJS library (react-side-effect) reads React through an
// interop shim whose `"default" in ex` test the analysis cannot decide, so both
// sides must resolve to the same React API for the class to have one base.

function _interopDefault(ex) {
  return ex && typeof ex === "object" && "default" in ex ? ex["default"] : ex;
}

var React__default = _interopDefault(React);

function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  subClass.__proto__ = superClass;
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

function getDisplayName(WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || "Component";
}

function withSideEffect(WrappedComponent) {
  var SideEffect = (function (_PureComponent) {
    _inheritsLoose(SideEffect, _PureComponent);

    function SideEffect() {
      return _PureComponent.apply(this, arguments) || this;
    }

    var _proto = SideEffect.prototype;

    _proto.render = function render() {
      return React__default.createElement(WrappedComponent, this.props);
    };

    return SideEffect;
  })(React__default.PureComponent);

  _defineProperty(
    SideEffect,
    "displayName",
    "SideEffect(" + getDisplayName(WrappedComponent) + ")",
  );

  return SideEffect;
}

var NullComponent = function NullComponent() {
  return null;
};

var Head = withSideEffect(NullComponent);

export default function CompiledInteropDefault() {
  return React.createElement(
    "main",
    null,
    React.createElement(Head, { title: "interop" }),
    React.createElement("p", null, "body"),
  );
}
