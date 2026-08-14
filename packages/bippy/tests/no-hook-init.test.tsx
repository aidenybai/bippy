import "../src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import {
  getFiberFromHostInstance,
  isInstrumentationActive,
  isRealReactDevtools,
} from "../src/index.js";
import type { ReactDevToolsGlobalHook } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const Example = () => {
  return <div>Hello</div>;
};

it("isRealReactDevtools should return false when passed null", () => {
  expect(isRealReactDevtools(null)).toBe(false);
});

it("isRealReactDevtools should detect devtools when hook has getFiberRoots", () => {
  const mockHookWithDevtools = {
    getFiberRoots: () => new Set(),
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  const mockHookWithoutDevtools = {
    renderers: new Map(),
  } as unknown as ReactDevToolsGlobalHook;

  expect(isRealReactDevtools(mockHookWithDevtools)).toBe(true);
  expect(isRealReactDevtools(mockHookWithoutDevtools)).toBe(false);
});

it("isInstrumentationActive should return true after render", () => {
  render(<Example />);
  expect(isInstrumentationActive()).toBe(true);
});

it("getFiberFromHostInstance should fallback to __reactFiber property", () => {
  const mockFiber = {
    child: null,
    flags: 0,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: {},
    tag: latestReactWorkTags.HostComponent,
    type: "div",
  };
  const element = document.createElement("div");
  Reflect.set(element, "__reactFiber$abc123", mockFiber);

  const result = getFiberFromHostInstance(element);
  expect(result).toBe(mockFiber);
});

it("getFiberFromHostInstance should fallback to __reactInternalInstance property", () => {
  const mockFiber = {
    child: null,
    flags: 0,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: {},
    tag: latestReactWorkTags.HostComponent,
    type: "span",
  };
  const element = document.createElement("span");
  Reflect.set(element, "__reactInternalInstance$xyz789", mockFiber);

  const result = getFiberFromHostInstance(element);
  expect(result).toBe(mockFiber);
});
