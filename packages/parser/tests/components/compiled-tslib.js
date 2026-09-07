import * as React from "react";

var __spreadArray =
  (this && this.__spreadArray) ||
  function (to, from, pack) {
    if (pack || arguments.length === 2)
      for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
        }
      }
    return to.concat(ar || Array.prototype.slice.call(from));
  };

function splitPathKey(key) {
  if (Array.isArray(key)) {
    return key;
  }
  if (typeof key === "number") {
    return [key];
  }
  if (key === "") {
    return [];
  }
  return key.split(".");
}

function pathSelector(path, state) {
  return [state].concat(path).reduce(function (v, a) {
    if (!v) {
      return undefined;
    }
    if (typeof v === "object" && a in v) {
      return v[a];
    } else if (Array.isArray(v) && typeof a === "string" && parseInt(a) in v) {
      return v[parseInt(a)];
    }
    return undefined;
  });
}

/** tslib `__spreadArray` helper feeding `[state].concat(path).reduce`, as kea-forms does. */
function Field(_a) {
  var name = _a.name,
    namePrefix = _a.namePrefix,
    errors = _a.errors;
  var namePath = __spreadArray(
    __spreadArray([], namePrefix || [], true),
    Array.isArray(name) ? name : splitPathKey(name),
    true,
  );
  var error = pathSelector(namePath, errors);
  return React.createElement(
    "div",
    null,
    React.createElement("span", null, namePath.join(".")),
    typeof error === "string" ? React.createElement("em", null, error) : null,
  );
}

export default function App() {
  return React.createElement(
    "section",
    null,
    React.createElement(Field, { name: "email", errors: {} }),
    React.createElement(Field, { name: "profile.city", errors: { profile: { city: "Required" } } }),
    React.createElement(Field, { name: "zip", namePrefix: ["address"], errors: { address: {} } }),
  );
}
