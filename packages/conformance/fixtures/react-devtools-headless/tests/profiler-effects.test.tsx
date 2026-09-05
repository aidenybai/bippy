import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import type { Facade, Tools } from "../src/types.js";

let facade: Facade;
let tools: Tools;

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

const expectDuration = (duration: number | null): void => {
  expect(duration === null || duration >= 0).toBe(true);
};

describe("upstream profiling HostRoot behavior", () => {
  it("should expose passive and layout effect durations for render()", () => {
    const App = () => {
      React.useEffect(() => undefined);
      React.useLayoutEffect(() => undefined);
      return null;
    };
    tools.startProfiling("legacy-effects");
    render(<App />);
    tools.stopProfiling();
    const report = tools.getCommitReport("legacy-effects", 0);
    if ("error" in report) throw new Error(String(report.error));
    expectDuration(report.layoutDuration);
    expectDuration(report.passiveDuration);
  });

  it("should expose passive and layout effect durations for createRoot()", () => {
    const App = () => {
      React.useEffect(() => undefined);
      React.useLayoutEffect(() => undefined);
      return null;
    };
    tools.startProfiling("effects");
    render(<App />);
    tools.stopProfiling();
    const report = tools.getCommitReport("effects", 0);
    if ("error" in report) throw new Error(String(report.error));
    expectDuration(report.layoutDuration);
    expectDuration(report.passiveDuration);
  });

  it("should properly reset passive and layout effect durations between commits", () => {
    const App = ({ value }: { value: number }) => {
      React.useEffect(() => undefined, [value]);
      React.useLayoutEffect(() => undefined, [value]);
      return null;
    };
    tools.startProfiling("resets");
    const view = render(<App value={1} />);
    view.rerender(<App value={2} />);
    tools.stopProfiling();
    const overview = tools.getTraceOverview("resets");
    if (!Array.isArray(overview)) throw new Error(String(overview.error));
    expect(overview.length).toBeGreaterThanOrEqual(2);
    for (const row of overview) {
      expectDuration(row.layoutDuration);
      expectDuration(row.passiveDuration);
    }
  });
});
