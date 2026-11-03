import { getDisplayName, getReactWorkTagsForFiber, isCompositeFiber, isHostFiber } from "bippy";
import type { Fiber } from "bippy";
import { isPlainRecord } from "../snapshot";
import { STAND_IN } from "../stubs/stand-in";
import { TRUNCATED_VALUE } from "../types";
import type { Capture, CaptureError, Shape } from "../types";
import { createCaptureError, getRecordedError, getRenderError } from "./errors";
import {
  MAX_CAPTURED_FIBERS,
  findMountedFiber,
  getChildren,
  getQueuedHooks,
  hasTooManyFibers,
} from "./fibers";
import { takeMutations } from "./mutations";
import { takeHandlerCalls, takeBranchHits } from "./coverage";

const ANONYMOUS_NAME = "Anonymous";
const MAX_PLAIN_DEPTH = 4;
const MAX_PLAIN_NODES = 2000;

const toShapes = (fiber: Fiber): Shape[] => {
  const workTags = getReactWorkTagsForFiber(fiber);
  if (fiber.tag === workTags.OffscreenComponent && fiber.memoizedState !== null) return [];
  if (fiber.tag === workTags.HostText) return [{ kind: "text", text: String(fiber.memoizedProps) }];
  if (isHostFiber(fiber)) {
    const children = getChildren(fiber).flatMap(toShapes);
    const textContent: unknown = fiber.memoizedProps?.children;
    const isTextOnly =
      children.length === 0 && (typeof textContent === "string" || typeof textContent === "number");
    return [
      {
        kind: "element",
        tag: String(fiber.type),
        children: isTextOnly ? [{ kind: "text", text: String(textContent) }] : children,
      },
    ];
  }
  if (isCompositeFiber(fiber))
    return [{ kind: "component", name: getDisplayName(fiber.type) ?? ANONYMOUS_NAME }];
  return getChildren(fiber).flatMap(toShapes);
};

const toPlainData = (value: unknown): unknown => {
  let nodeCount = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    )
      return current;
    if (current === undefined) return undefined;
    if (current === STAND_IN) return TRUNCATED_VALUE;
    if (typeof current === "function") return "[function]";
    if (depth >= MAX_PLAIN_DEPTH || typeof current !== "object") return "[value]";
    if (current instanceof Node) return "[node]";
    if (!isPlainRecord(current)) return TRUNCATED_VALUE;
    if (++nodeCount > MAX_PLAIN_NODES) return TRUNCATED_VALUE;
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [key, visit(item, depth + 1)]),
    );
  };
  return visit(value, 0);
};

export const createEmptyCapture = (error: CaptureError): Capture => ({
  shapes: [],
  stateValues: [],
  branchHits: takeBranchHits(true),
  handlerCalls: takeHandlerCalls(),
  mutationHits: [],
  mutatedOrigins: [],
  error,
});

export const captureMountedComponent = (): Capture => {
  const fiber = findMountedFiber();
  if (!fiber)
    return createEmptyCapture(
      getRecordedError() ?? createCaptureError("component did not render", null, "did-not-render"),
    );
  if (hasTooManyFibers(fiber))
    return createEmptyCapture(
      createCaptureError(
        `component rendered more than ${MAX_CAPTURED_FIBERS} fibers`,
        null,
        "too-large",
      ),
    );
  const renderError = getRenderError();
  return {
    shapes: getChildren(fiber).flatMap(toShapes),
    stateValues: getQueuedHooks(fiber).map((hook) => toPlainData(hook.memoizedState)),
    branchHits: takeBranchHits(renderError !== null),
    handlerCalls: takeHandlerCalls(),
    ...takeMutations(fiber),
    error: renderError,
  };
};
