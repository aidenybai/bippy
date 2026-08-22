// import react devtools, then bippy
/* eslint-disable @typescript-eslint/no-unsafe-call */

// @ts-expect-error - react-devtools-inline types not available
import { activate, initialize } from "react-devtools-inline/backend";
// @ts-expect-error - react-devtools-inline types not available
import { initialize as initializeFrontend } from "react-devtools-inline/frontend";
import { expect, vi } from "vite-plus/test";
import { getDevtoolsTestOrSkip } from "./devtools-test-or-skip.js";

initialize(window);

const React = await import("react");

const DevTools = initializeFrontend(window);

activate(window);

const { render } = await import("@testing-library/react");
const { instrument } = await import("../src/index.js");

const testOrSkip = getDevtoolsTestOrSkip(React.version);

testOrSkip("should be active", () => {
  render(<div>Hello</div>);
  render(<DevTools />);
  const onActive = vi.fn();
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
