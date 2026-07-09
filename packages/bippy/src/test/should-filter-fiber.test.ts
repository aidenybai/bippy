import { expect, it } from "vitest";
import {
  CONCURRENT_MODE_NUMBER,
  CONCURRENT_MODE_SYMBOL_STRING,
  DehydratedSuspenseComponentTag,
  DEPRECATED_ASYNC_MODE_SYMBOL_STRING,
  FragmentTag,
  FunctionComponentTag,
  HostRootTag,
  HostTextTag,
  shouldFilterFiber,
} from "../index.js";
import type { Fiber } from "../types.js";

const createMockFiber = (tag: number, type: unknown = null): Fiber =>
  ({
    alternate: null,
    child: null,
    flags: 0,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: null,
    tag,
    type,
  }) as unknown as Fiber;

it("should filter dehydrated suspense fibers", () => {
  expect(shouldFilterFiber(createMockFiber(DehydratedSuspenseComponentTag))).toBe(true);
});

it("should filter fragments and host text", () => {
  expect(shouldFilterFiber(createMockFiber(FragmentTag))).toBe(true);
  expect(shouldFilterFiber(createMockFiber(HostTextTag))).toBe(true);
});

it("should never filter the host root", () => {
  expect(shouldFilterFiber(createMockFiber(HostRootTag))).toBe(false);
});

it("should filter concurrent mode symbol types", () => {
  expect(
    shouldFilterFiber(createMockFiber(FunctionComponentTag, Symbol("react.concurrent_mode"))),
  ).toBe(true);
  expect(shouldFilterFiber(createMockFiber(FunctionComponentTag, Symbol("react.async_mode")))).toBe(
    true,
  );
  expect(shouldFilterFiber(createMockFiber(FunctionComponentTag, Symbol("react.whatever")))).toBe(
    false,
  );
});

it("should filter concurrent mode symbol types on object types", () => {
  expect(
    shouldFilterFiber(
      createMockFiber(FunctionComponentTag, { $$typeof: Symbol("react.concurrent_mode") }),
    ),
  ).toBe(true);
});

it("should filter legacy concurrent mode number and string types", () => {
  expect(shouldFilterFiber(createMockFiber(FunctionComponentTag, CONCURRENT_MODE_NUMBER))).toBe(
    true,
  );
  expect(
    shouldFilterFiber(createMockFiber(FunctionComponentTag, CONCURRENT_MODE_SYMBOL_STRING)),
  ).toBe(true);
  expect(
    shouldFilterFiber(createMockFiber(FunctionComponentTag, DEPRECATED_ASYNC_MODE_SYMBOL_STRING)),
  ).toBe(true);
});

it("should not filter regular function components", () => {
  expect(shouldFilterFiber(createMockFiber(FunctionComponentTag, () => null))).toBe(false);
});
