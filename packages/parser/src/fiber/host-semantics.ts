import { getObjectProperty, isKnownString } from "../evaluate/values.js";
import type {
  ComponentDefinition,
  StaticElementType,
  StaticObjectValue,
  StaticValue,
} from "../types.js";

const isNonNullish = (value: StaticValue): boolean =>
  !(value.kind === "primitive" && (value.value === null || value.value === undefined));

// Mirrors react-dom's shouldSetTextContent: these hosts never get child fibers.
export const shouldSetTextContent = (tagName: string, props: StaticObjectValue): boolean => {
  if (tagName === "textarea" || tagName === "noscript") return true;
  const children = getObjectProperty(props, "children");
  if (children.kind === "primitive") {
    const value = children.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
      return true;
  }
  if (
    children.kind === "unknown-primitive" &&
    (children.primitiveType === "string" || children.primitiveType === "number")
  ) {
    return true;
  }
  const innerHtml = getObjectProperty(props, "dangerouslySetInnerHTML");
  if (innerHtml.kind === "object") return isNonNullish(getObjectProperty(innerHtml, "__html"));
  return innerHtml.kind === "unknown" || innerHtml.kind === "external";
};

export const isHostSingleton = (tagName: string): boolean =>
  tagName === "html" || tagName === "head" || tagName === "body";

// Mirrors react-dom's isHostHoistableType outside of an SVG context.
export const isHostHoistable = (tagName: string, props: StaticObjectValue): boolean => {
  if (isNonNullish(getObjectProperty(props, "itemProp"))) return false;
  switch (tagName) {
    case "meta":
    case "title":
      return true;
    case "style": {
      const href = getObjectProperty(props, "href");
      return (
        isKnownString(getObjectProperty(props, "precedence")) &&
        isKnownString(href) &&
        href.kind === "primitive" &&
        href.value !== ""
      );
    }
    case "link": {
      const rel = getObjectProperty(props, "rel");
      const href = getObjectProperty(props, "href");
      if (
        !isKnownString(rel) ||
        !isKnownString(href) ||
        (href.kind === "primitive" && href.value === "")
      )
        return false;
      if (
        isNonNullish(getObjectProperty(props, "onLoad")) ||
        isNonNullish(getObjectProperty(props, "onError"))
      )
        return false;
      if (rel.kind === "primitive" && rel.value === "stylesheet") {
        return (
          isKnownString(getObjectProperty(props, "precedence")) &&
          !isNonNullish(getObjectProperty(props, "disabled"))
        );
      }
      return true;
    }
    case "script": {
      const src = getObjectProperty(props, "src");
      const isAsync = getObjectProperty(props, "async");
      if (!isKnownString(src) || !(isAsync.kind === "primitive" && Boolean(isAsync.value)))
        return false;
      return (
        !isNonNullish(getObjectProperty(props, "onLoad")) &&
        !isNonNullish(getObjectProperty(props, "onError"))
      );
    }
    default:
      return false;
  }
};

export const getComponentDisplayName = (component: ComponentDefinition): string | null => {
  const displayName = component.properties.get("displayName");
  if (displayName?.kind === "primitive" && typeof displayName.value === "string")
    return displayName.value;
  return component.name;
};

// Mirrors bippy's getDisplayName: explicit displayName, then the wrapped type's
// name, null for anonymous functions (React's own fallbacks such as
// "ForwardRef"/"Memo" are DevTools presentation, not fiber data).
export const getElementDisplayName = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class":
      return getComponentDisplayName(type.component);
    case "memo":
      return type.displayName ?? getElementDisplayName(type.inner);
    case "forward-ref":
      return type.displayName ?? getComponentDisplayName(type.component);
    case "lazy":
      return type.displayName ?? (type.inner ? getElementDisplayName(type.inner) : null);
    case "fragment":
      return "Fragment";
    case "strict-mode":
      return "StrictMode";
    case "profiler":
      return "Profiler";
    case "suspense":
      return "Suspense";
    case "suspense-list":
      return "SuspenseList";
    case "activity":
      return "Activity";
    case "view-transition":
      return "ViewTransition";
    case "context-provider":
    case "context-consumer":
      return type.displayName;
    case "portal":
      return "Portal";
    case "external":
      return type.displayName;
    case "stub":
      return type.stub.displayName;
    case "unknown":
      return type.displayName;
  }
};

export const hasDefaultProps = (component: ComponentDefinition): boolean => {
  const defaults = component.properties.get("defaultProps");
  return defaults !== undefined && isNonNullish(defaults);
};

export const applyDefaultProps = (
  component: ComponentDefinition,
  props: StaticObjectValue,
): StaticObjectValue => {
  const defaults = component.properties.get("defaultProps");
  if (!defaults || !isNonNullish(defaults)) return props;
  return { kind: "object", entries: [{ kind: "spread", value: defaults }, ...props.entries] };
};
