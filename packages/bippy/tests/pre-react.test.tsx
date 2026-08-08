// import react, then bippy

import React from "react";
import { expect, it, vi } from "vite-plus/test";
const { instrument } = await import("../src/index.js"); // delay it
import { render } from "@testing-library/react";

it("should not be active", () => {
  const onActive = vi.fn();
  render(<div>Hello</div>);
  instrument({
    onActive,
  });
  expect(onActive).not.toHaveBeenCalled();
});
