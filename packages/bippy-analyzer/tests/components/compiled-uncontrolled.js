import * as React from "react";
import { useCallback, useRef, useState } from "react";

// uncontrollable's `useUncontrolled` as Babel emits it: the excluded keys of the
// rest are computed (`'default' + key.charAt(0).toUpperCase() + key.substr(1)`)
// and coerced through the inlined `_toPropertyKey` before reaching
// `_objectWithoutPropertiesLoose`.

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;
  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }
  return target;
}
function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, "string");
  return typeof key === "symbol" ? key : String(key);
}
function _toPrimitive(input, hint) {
  if (typeof input !== "object" || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || "default");
    if (typeof res !== "object") return res;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (hint === "string" ? String : Number)(input);
}

function defaultKey(key) {
  return "default" + key.charAt(0).toUpperCase() + key.substr(1);
}

function useUncontrolledProp(propValue, defaultValue, handler) {
  const wasPropRef = useRef(propValue !== undefined);
  const [stateValue, setState] = useState(defaultValue);
  const isProp = propValue !== undefined;
  const wasProp = wasPropRef.current;
  wasPropRef.current = isProp;
  if (!isProp && wasProp && stateValue !== defaultValue) {
    setState(defaultValue);
  }
  return [
    isProp ? propValue : stateValue,
    useCallback(
      (...args) => {
        const [value, ...rest] = args;
        let returnValue = handler == null ? void 0 : handler(value, ...rest);
        setState(value);
        return returnValue;
      },
      [handler],
    ),
  ];
}

function useUncontrolled(props, config) {
  return Object.keys(config).reduce((result, fieldName) => {
    const _ref = result,
      _defaultKey = defaultKey(fieldName),
      { [_defaultKey]: defaultValue, [fieldName]: propsValue } = _ref,
      rest = _objectWithoutPropertiesLoose(_ref, [_defaultKey, fieldName].map(_toPropertyKey));
    const handlerName = config[fieldName];
    const [value, handler] = useUncontrolledProp(propsValue, defaultValue, props[handlerName]);
    return Object.assign({}, rest, {
      [fieldName]: value,
      [handlerName]: handler,
    });
  }, props);
}

const Navbar = React.forwardRef((props, ref) => {
  const {
    as: Component = "nav",
    expanded,
    onToggle,
    ...controlledProps
  } = useUncontrolled(props, { expanded: "onToggle" });
  if (controlledProps.role === undefined && Component !== "nav") {
    controlledProps.role = "navigation";
  }
  return React.createElement(Component, {
    ref: ref,
    ...controlledProps,
    "data-expanded": String(!!expanded),
    onClick: () => (onToggle == null ? void 0 : onToggle(!expanded)),
  });
});
Navbar.displayName = "Navbar";

export default function CompiledUncontrolled() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Navbar, { id: "primary", className: "navbar" }),
    React.createElement(Navbar, { as: "header", className: "navbar", defaultExpanded: true }),
    React.createElement("span", null, "abcdef".substr(2, 3), "abcdef".substr(-2)),
  );
}
