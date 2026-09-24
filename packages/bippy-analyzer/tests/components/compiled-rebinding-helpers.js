import * as React from "react";

function extendsHelper() {
  return (
    (extendsHelper = Object.assign
      ? Object.assign.bind()
      : function (target) {
          for (var index = 1; index < arguments.length; index++) {
            var source = arguments[index];
            for (var key in source) {
              ({}).hasOwnProperty.call(source, key) && (target[key] = source[key]);
            }
          }
          return target;
        }),
    extendsHelper.apply(null, arguments)
  );
}

function typeOfHelper(value) {
  return (
    (typeOfHelper =
      typeof Symbol === "function" && typeof Symbol.iterator === "symbol"
        ? function (inner) {
            return typeof inner;
          }
        : function (inner) {
            return inner &&
              typeof Symbol === "function" &&
              inner.constructor === Symbol &&
              inner !== Symbol.prototype
              ? "symbol"
              : typeof inner;
          }),
    typeOfHelper(value)
  );
}

function Chart(props) {
  var type = props.type === undefined ? "line" : props.type;
  var rest = extendsHelper({}, props, { "data-type": type });
  delete rest.type;
  return React.createElement("div", extendsHelper({ ref: React.useRef(null) }, rest));
}

export default function CompiledRebindingHelpers() {
  var options = extendsHelper({}, { legend: true }, { legend: false, series: [1, 2] });
  return React.createElement(
    "section",
    { "data-kind": typeOfHelper({}) },
    React.createElement(Chart, { id: "sales", type: "bar" }),
    React.createElement(Chart, { id: "visits" }),
    options.legend ? React.createElement("aside", null, "legend") : null,
    typeOfHelper(options) === "object"
      ? React.createElement("p", null, options.series.length)
      : null,
  );
}

export const isExact = true;
