import { expect, it } from "vitest";
import {
  getReactWorkTags,
  HostComponentTag,
  HostHoistableTag,
  HostSingletonTag,
  HostTextTag,
  ReactWorkTags,
} from "../src/react-internals.js";

it("selects React work tags by their version baseline", () => {
  expect(getReactWorkTags("17.0.1")).toBe(ReactWorkTags["17.0.1"]);
  expect(getReactWorkTags("17.0.2")).toBe(ReactWorkTags["17.0.2"]);
  expect(getReactWorkTags("18.3.1")).toBe(ReactWorkTags["17.0.2"]);
  expect(getReactWorkTags("19.2.0-canary")).toBe(ReactWorkTags["17.0.2"]);
});

it("derives public host tags from the React 17.0.2 baseline", () => {
  expect(HostComponentTag).toBe(ReactWorkTags["17.0.2"].HostComponent);
  expect(HostTextTag).toBe(ReactWorkTags["17.0.2"].HostText);
  expect(HostHoistableTag).toBe(ReactWorkTags["17.0.2"].HostHoistable);
  expect(HostSingletonTag).toBe(ReactWorkTags["17.0.2"].HostSingleton);
});
