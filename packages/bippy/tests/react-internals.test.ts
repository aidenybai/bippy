import { expect, it } from "vitest";
import {
  getReactWorkTags,
  HostComponentTag,
  HostHoistableTag,
  HostSingletonTag,
  HostTextTag,
  ModernReactWorkTags,
  React17WorkTags,
} from "../src/react-internals.js";

it("selects React 17 work tags independently from modern React work tags", () => {
  expect(getReactWorkTags("17.0.1")).toBe(React17WorkTags);
  expect(getReactWorkTags("17.0.2")).toBe(ModernReactWorkTags);
  expect(getReactWorkTags("18.3.1")).toBe(ModernReactWorkTags);
  expect(getReactWorkTags("19.2.0-canary")).toBe(ModernReactWorkTags);
});

it("derives public host tags from the modern work-tag table", () => {
  expect(HostComponentTag).toBe(ModernReactWorkTags.HostComponent);
  expect(HostTextTag).toBe(ModernReactWorkTags.HostText);
  expect(HostHoistableTag).toBe(ModernReactWorkTags.HostHoistable);
  expect(HostSingletonTag).toBe(ModernReactWorkTags.HostSingleton);
});
