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

const TREE_OPERATION_ADD = 1;
const TREE_OPERATION_REMOVE = 2;
const TREE_OPERATION_REORDER_CHILDREN = 3;
const TREE_OPERATION_UPDATE_TREE_BASE_DURATION = 4;
const TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS = 5;
const TREE_OPERATION_SET_SUBTREE_MODE = 7;
const SUSPENSE_TREE_OPERATION_ADD = 8;
const SUSPENSE_TREE_OPERATION_REMOVE = 9;
const SUSPENSE_TREE_OPERATION_REORDER_CHILDREN = 10;
const SUSPENSE_TREE_OPERATION_RESIZE = 11;
const SUSPENSE_TREE_OPERATION_SUSPENDERS = 12;
const TREE_OPERATION_APPLIED_ACTIVITY_SLICE_CHANGE = 13;
const ELEMENT_TYPE_ROOT = 11;
const ADD_ROOT_FIELD_COUNT = 4;
const ADD_NODE_FIELD_COUNT = 5;
const RECT_FIELD_COUNT = 4;

const utfDecodeStringWithRanges = (operations: number[], left: number, right: number): string => {
  let decoded = "";
  for (let index = left; index <= right; index++)
    decoded += String.fromCodePoint(operations[index]);
  return decoded;
};

const formatRects = (operations: number[], startIndex: number, rectCount: number): string => {
  if (rectCount === -1) return "null";
  const rects: string[] = [];
  for (let rectIndex = 0; rectIndex < rectCount; rectIndex++) {
    const offset = startIndex + rectIndex * RECT_FIELD_COUNT;
    const [x, y, width, height] = operations.slice(offset, offset + RECT_FIELD_COUNT);
    rects.push(`(${x}, ${y}, ${width}, ${height})`);
  }
  return `[${rects.join(", ")}]`;
};

export const printOperationsArray = (operations: number[]): void => {
  const rendererId = operations[0];
  const rootId = operations[1];
  const logs = [`operations for renderer:${rendererId} and root:${rootId}`];
  let index = 2;

  const stringTable: Array<string | null> = [null];
  const stringTableSize = operations[index++] ?? 0;
  const stringTableEnd = index + stringTableSize;
  while (index < stringTableEnd) {
    const stringLength = operations[index++];
    stringTable.push(utfDecodeStringWithRanges(operations, index, index + stringLength - 1));
    index += stringLength;
  }

  while (index < operations.length) {
    const operation = operations[index];
    switch (operation) {
      case TREE_OPERATION_ADD: {
        const id = operations[index + 1];
        const elementType = operations[index + 2];
        index += 3;
        if (elementType === ELEMENT_TYPE_ROOT) {
          index += ADD_ROOT_FIELD_COUNT;
          logs.push(`Add new root node ${id}`);
        } else {
          const parentId = operations[index];
          const displayName = stringTable[operations[index + 2]];
          index += ADD_NODE_FIELD_COUNT;
          logs.push(`Add node ${id} (${displayName || "null"}) as child of ${parentId}`);
        }
        break;
      }
      case TREE_OPERATION_REMOVE:
      case SUSPENSE_TREE_OPERATION_REMOVE: {
        const nodeLabel = operation === TREE_OPERATION_REMOVE ? "node" : "suspense node";
        const removeCount = operations[index + 1];
        index += 2;
        for (let removeIndex = 0; removeIndex < removeCount; removeIndex++) {
          logs.push(`Remove ${nodeLabel} ${operations[index++]}`);
        }
        break;
      }
      case TREE_OPERATION_REORDER_CHILDREN:
      case SUSPENSE_TREE_OPERATION_REORDER_CHILDREN: {
        const nodeLabel = operation === TREE_OPERATION_REORDER_CHILDREN ? "node" : "suspense node";
        const id = operations[index + 1];
        const childCount = operations[index + 2];
        index += 3;
        const children = operations.slice(index, index + childCount);
        index += childCount;
        logs.push(`Re-order ${nodeLabel} ${id} children ${children.join(",")}`);
        break;
      }
      case TREE_OPERATION_UPDATE_TREE_BASE_DURATION:
        index += 3;
        break;
      case TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS: {
        const id = operations[index + 1];
        const errorCount = operations[index + 2];
        const warningCount = operations[index + 3];
        index += 4;
        logs.push(`Node ${id} has ${errorCount} errors and ${warningCount} warnings`);
        break;
      }
      case TREE_OPERATION_SET_SUBTREE_MODE: {
        const id = operations[index + 1];
        const mode = operations[index + 2];
        index += 3;
        logs.push(`Mode ${mode} set for subtree with root ${id}`);
        break;
      }
      case SUSPENSE_TREE_OPERATION_ADD: {
        const fiberId = operations[index + 1];
        const parentId = operations[index + 2];
        const name = stringTable[operations[index + 3]];
        const isSuspended = operations[index + 4];
        const rectCount = operations[index + 5];
        index += 6;
        const rects = formatRects(operations, index, rectCount);
        index += Math.max(rectCount, 0) * RECT_FIELD_COUNT;
        logs.push(
          `Add suspense node ${fiberId} (${String(name)},rects={${rects}}) under ${parentId} suspended ${isSuspended}`,
        );
        break;
      }
      case SUSPENSE_TREE_OPERATION_RESIZE: {
        const id = operations[index + 1];
        const rectCount = operations[index + 2];
        index += 3;
        const rects = formatRects(operations, index, rectCount);
        index += Math.max(rectCount, 0) * RECT_FIELD_COUNT;
        logs.push(`Resize suspense node ${id} to ${rects}`);
        break;
      }
      case SUSPENSE_TREE_OPERATION_SUSPENDERS: {
        const changeCount = operations[index + 1];
        index += 2;
        for (let changeIndex = 0; changeIndex < changeCount; changeIndex++) {
          const id = operations[index++];
          const hasUniqueSuspenders = operations[index++] === 1;
          const endTime = operations[index++] / 1000;
          const isSuspended = operations[index++] === 1;
          const environmentNamesLength = operations[index++];
          index += environmentNamesLength;
          logs.push(
            `Suspense node ${id} unique suspenders set to ${String(hasUniqueSuspenders)} ending at ${String(endTime)} is suspended set to ${String(isSuspended)} with ${String(environmentNamesLength)} environments`,
          );
        }
        break;
      }
      case TREE_OPERATION_APPLIED_ACTIVITY_SLICE_CHANGE: {
        const activitySliceId = operations[index + 1];
        index += 2;
        logs.push(
          activitySliceId === 0
            ? "Reset applied activity slice"
            : `Applied activity slice change to ${activitySliceId}`,
        );
        break;
      }
      default:
        throw new Error(`Unsupported Bridge operation ${operation}`);
    }
  }
  console.log(logs.join("\n"));
};
