import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { FiberRoot } from "bippy";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import { MAX_RETAINED_TRACES } from "../src/profiler-tools.js";
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

const getFiberRoot = (): FiberRoot => {
  const root = facade.fiberRoots.values().next().value?.values().next().value;
  if (!root) throw new Error("Missing Fiber root");
  return root;
};

describe("profiler passive effect attribution", () => {
  it("attributes each passive flush to the commit that scheduled it", () => {
    render(<div />);
    const root = getFiberRoot();
    tools.startProfiling("queued-passive");
    const { onCommit, onPostCommit } = facade.profilingState;
    if (!onCommit || !onPostCommit) throw new Error("Profiling callbacks are not installed");

    onCommit(0, root, 3);
    onCommit(0, root, 3);
    root.passiveEffectDuration = 4;
    onPostCommit(root);
    root.passiveEffectDuration = 9;
    onPostCommit(root);
    tools.stopProfiling();

    const overview = tools.getTraceOverview("queued-passive");
    if (!Array.isArray(overview)) throw new Error(String(overview.error));
    expect(overview.map((row) => row.passiveDuration)).toEqual([4, 9]);
  });

  it("ignores passive flushes without a pending commit", () => {
    render(<div />);
    const root = getFiberRoot();
    tools.startProfiling("extra-passive");
    const { onCommit, onPostCommit } = facade.profilingState;
    if (!onCommit || !onPostCommit) throw new Error("Profiling callbacks are not installed");

    onCommit(0, root, 3);
    root.passiveEffectDuration = 2;
    onPostCommit(root);
    root.passiveEffectDuration = 7;
    onPostCommit(root);
    tools.stopProfiling();

    const overview = tools.getTraceOverview("extra-passive");
    if (!Array.isArray(overview)) throw new Error(String(overview.error));
    expect(overview.map((row) => row.passiveDuration)).toEqual([2]);
  });
});

describe("profiler trace retention", () => {
  it("rejects reusing the name of an existing trace", () => {
    tools.startProfiling("reused");
    tools.stopProfiling();
    expect(tools.startProfiling("reused")).toEqual({
      error: 'Trace "reused" already exists',
    });
  });

  it("generates unique names for traces started in the same millisecond", () => {
    const names = new Set<string>();
    for (let traceIndex = 0; traceIndex < 5; traceIndex++) {
      const result = tools.startProfiling();
      if ("error" in result) throw new Error(String(result.error));
      names.add(result.traceName);
      tools.stopProfiling();
    }
    expect(names.size).toBe(5);
  });

  it("evicts the oldest traces once the retention limit is reached", () => {
    for (let traceIndex = 0; traceIndex < MAX_RETAINED_TRACES + 3; traceIndex++) {
      tools.startProfiling(`trace-${traceIndex}`);
      tools.stopProfiling();
    }
    expect(facade.profilingState.traces.size).toBe(MAX_RETAINED_TRACES);
    expect(tools.getTraceOverview("trace-0")).toEqual({
      error: 'Unknown trace "trace-0"',
    });
    expect(tools.getTraceOverview(`trace-${MAX_RETAINED_TRACES + 2}`)).toEqual([]);
  });
});
