import * as React from "react";
import _objectWithoutProperties from "@babel/runtime/helpers/esm/objectWithoutProperties";
import * as IconExports from "./shared/icon-exports";

var IconNameMapper = IconExports.IconNameMapper,
  icons = _objectWithoutProperties(IconExports, ["IconNameMapper"]);

function Icon(props) {
  var iconName = IconNameMapper[props.icon] || "";
  var Component = icons[iconName];
  if (Component) {
    return React.createElement(Component, { label: props.icon });
  }
  return React.createElement("em", null, props.icon);
}

export const isExact = true;

export default function CompiledNamespaceRest() {
  return React.createElement(
    "ul",
    null,
    React.createElement("li", null, React.createElement(Icon, { icon: "cog" })),
    React.createElement("li", null, React.createElement(Icon, { icon: "tick" })),
    React.createElement("li", null, React.createElement(Icon, { icon: "missing" })),
    React.createElement("li", null, Object.keys(icons).join(",")),
  );
}
