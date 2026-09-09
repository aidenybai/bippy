import { unknownValue } from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider } from "../types.js";

export const REACT_LIFECYCLES_COMPAT_PACKAGES = ["react-lifecycles-compat"];

/**
 * `polyfill(Component)` returns the class itself after installing legacy
 * lifecycles that back-port `getDerivedStateFromProps`/`getSnapshotBeforeUpdate`
 * to React < 16.3; React 16.3+ never calls those legacy methods when the new
 * APIs are defined, so on every supported React the class renders unchanged.
 */
export const reactLifecyclesCompatValue: ExternalValueProvider = (specifier, importedName) => {
  if (!REACT_LIFECYCLES_COMPAT_PACKAGES.includes(specifier) || importedName !== "polyfill") {
    return null;
  }
  return nativeFunction("polyfill", ([component]) =>
    component?.kind === "class" ||
    (component?.kind === "component-reference" && component.type.kind === "class")
      ? component
      : unknownValue("polyfill() of a non-class component"),
  );
};
