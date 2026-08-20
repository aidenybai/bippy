import { getDisplayName as getBippyDisplayName } from "bippy";
import { parseStack } from "bippy/source";
import type { ReactElement } from "react";

export interface ComponentLocation {
  column: number;
  componentName: string;
  line: number;
  url: string;
}

export type ReactFunctionLocation = [string, string, number, number];

const safeToString = (value: unknown): string => {
  try {
    return String(value);
  } catch (error) {
    if (typeof value === "object") return "[object Object]";
    throw error;
  }
};

export const getDisplayName = (value: object, fallbackName = "Anonymous"): string =>
  getBippyDisplayName(value) ?? fallbackName;

const elementNames = new Map<symbol, string>([
  [Symbol.for("react.consumer"), "ContextConsumer"],
  [Symbol.for("react.provider"), "ContextProvider"],
  [Symbol.for("react.context"), "Context"],
  [Symbol.for("react.forward_ref"), "ForwardRef"],
  [Symbol.for("react.fragment"), "Fragment"],
  [Symbol.for("react.lazy"), "Lazy"],
  [Symbol.for("react.memo"), "Memo"],
  [Symbol.for("react.portal"), "Portal"],
  [Symbol.for("react.profiler"), "Profiler"],
  [Symbol.for("react.strict_mode"), "StrictMode"],
  [Symbol.for("react.suspense"), "Suspense"],
  [Symbol.for("react.suspense_list"), "SuspenseList"],
  [Symbol.for("react.view_transition"), "ViewTransition"],
  [Symbol.for("react.tracing_marker"), "TracingMarker"],
]);

export const getDisplayNameForReactElement = (element: ReactElement): string => {
  const elementType = element.type;
  if (typeof elementType === "symbol") {
    return elementNames.get(elementType) ?? "NotImplementedInDevtools";
  }
  if (typeof elementType === "string") return elementType;
  if (typeof elementType === "function") return getDisplayName(elementType);
  if (elementType === null || elementType === undefined) return "Element";
  if (typeof elementType === "object") {
    const marker = Reflect.get(elementType, "$$typeof");
    if (typeof marker === "symbol") return elementNames.get(marker) ?? "NotImplementedInDevtools";
  }
  return "NotImplementedInDevtools";
};

export const formatConsoleArgumentsToSingleString = (
  maybeMessage: unknown,
  ...inputArguments: unknown[]
): string => {
  const arguments_ = [...inputArguments];
  let formatted = safeToString(maybeMessage);
  if (typeof maybeMessage === "string" && arguments_.length > 0) {
    formatted = formatted.replace(/(%?)(%([jdisf]))/g, (match, escaped, _pattern, flag) => {
      let argument = arguments_.shift();
      if (flag === "s") argument = `${safeToString(argument)}`;
      else if (flag === "d" || flag === "i")
        argument = Number.parseInt(String(argument), 10).toString();
      else if (flag === "f") argument = Number.parseFloat(String(argument)).toString();
      if (!escaped) return safeToString(argument);
      arguments_.unshift(argument);
      return match;
    });
  }
  for (const argument of arguments_) formatted += ` ${safeToString(argument)}`;
  return formatted.replace(/%{2}/g, "%");
};

export const formatConsoleArguments = (
  maybeMessage?: unknown,
  ...inputArguments: unknown[]
): unknown[] => {
  if (inputArguments.length === 0 || typeof maybeMessage !== "string") {
    return maybeMessage === undefined && inputArguments.length === 0
      ? []
      : [maybeMessage, ...inputArguments];
  }
  const arguments_ = [...inputArguments];
  let template = "";
  let argumentIndex = 0;
  for (let index = 0; index < maybeMessage.length; index++) {
    const character = maybeMessage[index];
    if (character !== "%") {
      template += character;
      continue;
    }
    const specifier = maybeMessage[++index];
    if (specifier === "c" || specifier === "o" || specifier === "O") {
      argumentIndex++;
      template += `%${specifier}`;
    } else if (specifier === "d" || specifier === "i" || specifier === "f" || specifier === "s") {
      if (argumentIndex >= arguments_.length) {
        template += `%${specifier}`;
        continue;
      }
      const argument = arguments_.splice(argumentIndex, 1)[0];
      if (specifier === "d" || specifier === "i") template += Number.parseInt(String(argument), 10);
      else if (specifier === "f") template += Number.parseFloat(String(argument));
      else template += String(argument);
    } else {
      template += specifier === undefined ? "%" : `%${specifier}`;
    }
  }
  return [template, ...arguments_];
};

export const formatWithStyles = (
  inputArguments: readonly unknown[] | undefined,
  style?: string,
): readonly unknown[] | undefined => {
  if (
    inputArguments === undefined ||
    inputArguments.length === 0 ||
    (typeof inputArguments[0] === "string" && /([^%]|^)(%c)/g.test(inputArguments[0])) ||
    style === undefined
  ) {
    return inputArguments;
  }
  const substitutionPattern = /([^%]|^)((%%)*)(%([oOdisf]))/g;
  if (typeof inputArguments[0] === "string" && substitutionPattern.test(inputArguments[0])) {
    return [`%c${inputArguments[0]}`, style, ...inputArguments.slice(1)];
  }
  const template = inputArguments.reduce<string>((format, element, index) => {
    const separator = index > 0 ? " " : "";
    if (
      typeof element === "string" ||
      typeof element === "boolean" ||
      typeof element === "symbol"
    ) {
      return `${format}${separator}%s`;
    }
    if (typeof element === "number") {
      return `${format}${separator}${Number.isInteger(element) ? "%i" : "%f"}`;
    }
    return `${format}${separator}%o`;
  }, "%c");
  return [template, style, ...inputArguments];
};

const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
};

export const gt = (left = "", right = ""): boolean => compareVersions(left, right) === 1;
export const gte = (left = "", right = ""): boolean => compareVersions(left, right) >= 0;

export const isPlainObject = (value: unknown): boolean => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!prototype) return true;
  return !Object.getPrototypeOf(prototype);
};

const parseStackFrame = (frame: string): ReactFunctionLocation | null => {
  const stackFrame = parseStack(frame, { includeInElement: false })[0];
  if (
    !stackFrame?.fileName ||
    stackFrame.lineNumber === undefined ||
    stackFrame.columnNumber === undefined
  ) {
    return null;
  }
  return [
    stackFrame.functionName ?? "",
    stackFrame.fileName,
    stackFrame.lineNumber,
    stackFrame.columnNumber,
  ];
};

export const extractLocationFromComponentStack = (stack: string): ReactFunctionLocation | null => {
  for (const frame of stack.split("\n")) {
    const location = parseStackFrame(frame);
    if (location && location[1].includes(":")) return location;
  }
  return null;
};

export const stackToComponentLocations = (
  stack: string,
): Array<[string, ReactFunctionLocation | null]> =>
  stack
    .split(/\n\s+at /)
    .slice(1)
    .map((frame) => {
      const match = /([^\s]+) \((.+):(\d+):(\d+)\)/.exec(frame);
      return match
        ? [match[1], [match[1], match[2], Number(match[3]), Number(match[4])]]
        : [frame, null];
    });

export const printOperationsArray = (operations: number[]): void => {
  const rendererId = operations[0];
  const rootId = operations[1];
  const logs = [`operations for renderer:${rendererId} and root:${rootId}`];
  let index = 2;
  const stringTableSize = operations[index++] ?? 0;
  index += stringTableSize;
  while (index < operations.length) {
    const operation = operations[index++];
    if (operation === 13) {
      const activitySliceId = operations[index++];
      logs.push(
        activitySliceId === 0
          ? "Reset applied activity slice"
          : `Applied activity slice change to ${activitySliceId}`,
      );
    } else {
      throw new Error(`Unsupported Bridge operation ${operation}`);
    }
  }
  console.log(logs.join("\n"));
};
