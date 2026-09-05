// import bippy, then react devtools
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { expect, vi } from "vite-plus/test";
import { getDevtoolsTestOrSkip } from "./devtools-test-or-skip.js";
const { instrument } = await import("../../../bippy/src/index.js");

// @ts-expect-error - react-devtools-inline types not available
import { activate, initialize } from "react-devtools-inline/backend";
// @ts-expect-error - react-devtools-inline types not available
import { initialize as initializeFrontend } from "react-devtools-inline/frontend";

initialize(window);

const DevTools = initializeFrontend(window);

activate(window);
const React = await import("react");
const { render } = await import("@testing-library/react");

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
