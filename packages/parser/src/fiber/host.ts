import {
  getObjectProperty,
  getTruthiness,
  isNullish,
  type ObjectValue,
  type StaticValue,
} from "../analyze/values.js";
import type { WorkTagName } from "./types.js";

/** `typeof value === "string"` when statically decidable; unknown values are assumed strings. */
const isStringLike = (value: StaticValue): boolean => {
  switch (value.kind) {
    case "literal":
      return typeof value.value === "string";
    case "text":
    case "unknown":
      return true;
    case "conditional":
      return isStringLike(value.whenTrue) && isStringLike(value.whenFalse);
    default:
      return false;
  }
};

const isNonEmptyString = (value: StaticValue): boolean =>
  isStringLike(value) && !(value.kind === "literal" && value.value === "");

const isTruthy = (value: StaticValue): boolean => getTruthiness(value) !== false;

const isDefined = (value: StaticValue): boolean =>
  !(value.kind === "literal" && isNullish(value.value));

/**
 * `shouldSetTextContent` from `ReactFiberConfigDOM`: a lone string child is
 * written as `textContent` and gets no `HostText` fiber. Children that are
 * strings only on some paths are handled by the reconciler's branch logic.
 */
export const shouldSetTextContent = (tagName: string, props: ObjectValue): boolean => {
  if (tagName === "textarea" || tagName === "noscript") return true;
  const innerHtml = props.properties.get("dangerouslySetInnerHTML");
  if (!innerHtml) return false;
  if (innerHtml.kind === "object") return isDefined(getObjectProperty(innerHtml, "__html"));
  return innerHtml.kind !== "literal";
};

/** Whether a child value written directly as `children` is set as text content. */
export const isDirectTextChild = (value: StaticValue): boolean => {
  switch (value.kind) {
    case "literal":
      return (
        typeof value.value === "string" ||
        typeof value.value === "number" ||
        typeof value.value === "bigint"
      );
    case "text":
      return true;
    default:
      return false;
  }
};

export const isHostSingletonType = (tagName: string): boolean =>
  tagName === "html" || tagName === "head" || tagName === "body";

/**
 * `isHostHoistableType` from `ReactFiberConfigDOM`: resources React hoists
 * into `<head>` and manages without reconciler children.
 */
export const isHostHoistableType = (
  tagName: string,
  props: ObjectValue,
  isInsideSvg: boolean,
): boolean => {
  if (isInsideSvg || isDefined(getObjectProperty(props, "itemProp"))) return false;
  const prop = (name: string): StaticValue => getObjectProperty(props, name);
  switch (tagName) {
    case "meta":
    case "title":
      return true;
    case "style":
      return isStringLike(prop("precedence")) && isNonEmptyString(prop("href"));
    case "link": {
      if (
        !isStringLike(prop("rel")) ||
        !isNonEmptyString(prop("href")) ||
        isTruthy(prop("onLoad")) ||
        isTruthy(prop("onError"))
      ) {
        return false;
      }
      const rel = prop("rel");
      if (rel.kind === "literal" && rel.value === "stylesheet") {
        return isStringLike(prop("precedence")) && !isDefined(prop("disabled"));
      }
      return rel.kind === "literal";
    }
    case "script":
      return (
        getTruthiness(prop("async")) === true &&
        !isTruthy(prop("onLoad")) &&
        !isTruthy(prop("onError")) &&
        isNonEmptyString(prop("src")) &&
        prop("src").kind !== "unknown"
      );
    default:
      return false;
  }
};

export const getHostWorkTag = (
  tagName: string,
  props: ObjectValue,
  isInsideSvg: boolean,
): WorkTagName => {
  if (isHostHoistableType(tagName, props, isInsideSvg)) return "HostHoistable";
  return isHostSingletonType(tagName) ? "HostSingleton" : "HostComponent";
};
