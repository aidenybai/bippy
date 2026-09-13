import { getObjectProperty, getTruthiness, unknownValue } from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { ExternalValueProvider, StaticValue } from "../types.js";

export const HOIST_NON_REACT_STATICS_PACKAGES = ["hoist-non-react-statics"];

const NON_HOISTED_STATICS: ReadonlySet<string> = new Set([
  "childContextTypes",
  "contextType",
  "contextTypes",
  "defaultProps",
  "displayName",
  "getDefaultProps",
  "getDerivedStateFromError",
  "getDerivedStateFromProps",
  "mixins",
  "propTypes",
  "type",
  "$$typeof",
  "compare",
  "render",
  "name",
  "length",
  "prototype",
  "caller",
  "callee",
  "arguments",
  "arity",
]);

const isBlacklisted = (blacklist: StaticValue | undefined, key: string): boolean =>
  blacklist?.kind === "object" && getTruthiness(getObjectProperty(blacklist, key)) === true;

const getOwnStatics = (value: StaticValue | undefined): Map<string, StaticValue> | null => {
  if (value?.kind === "function" || value?.kind === "class") return value.properties;
  if (value?.kind !== "component-reference") return null;
  const type = value.type;
  if (type.kind === "function" || type.kind === "class") return type.component.properties;
  return type.kind === "memo" || type.kind === "forward-ref" || type.kind === "lazy"
    ? type.properties
    : null;
};

const hoistNonReactStatics = (
  target: StaticValue | undefined,
  source: StaticValue | undefined,
  blacklist: StaticValue | undefined,
): StaticValue => {
  if (!target) return unknownValue("hoistNonReactStatics() without a target");
  const targetStatics = getOwnStatics(target);
  const sourceStatics = getOwnStatics(source);
  if (!targetStatics || !sourceStatics) return target;
  for (const [key, value] of sourceStatics) {
    if (
      !NON_HOISTED_STATICS.has(key) &&
      !targetStatics.has(key) &&
      !isBlacklisted(blacklist, key)
    ) {
      targetStatics.set(key, value);
    }
  }
  return target;
};

export const hoistNonReactStaticsValue: ExternalValueProvider = (specifier, importedName) => {
  if (!HOIST_NON_REACT_STATICS_PACKAGES.includes(specifier)) return null;
  return importedName === "default"
    ? nativeFunction("hoistNonReactStatics", ([target, source, blacklist]) =>
        hoistNonReactStatics(target, source, blacklist),
      )
    : null;
};
