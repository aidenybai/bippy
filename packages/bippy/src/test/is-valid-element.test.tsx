import "../index.js"; // KEEP THIS LINE ON TOP

import React from "react";
import { expect, it } from "vitest";
import { isValidElement } from "../index.js";

it("should return true for a jsx element", () => {
  expect(isValidElement(<div>Hello</div>)).toBe(true);
});

it("should return true for createElement output", () => {
  expect(isValidElement(React.createElement("span"))).toBe(true);
});

it("should return false for non-elements", () => {
  expect(isValidElement(null)).toBe(false);
  expect(isValidElement(undefined)).toBe(false);
  expect(isValidElement("div")).toBe(false);
  expect(isValidElement({})).toBe(false);
  expect(isValidElement({ $$typeof: Symbol.for("react.portal") })).toBe(false);
});
