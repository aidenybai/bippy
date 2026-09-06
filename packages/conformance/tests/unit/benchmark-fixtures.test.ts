import { expect, it, vi } from "vite-plus/test";
import * as Bippy from "../../../bippy/src/index.js";
import * as Source from "../../../bippy/src/source/index.js";
import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { createHookBenchmarks } from "../../benchmarks/hooks.js";
import { createCoreBenchmarks } from "../../benchmarks/core.js";
import { runBenchmark } from "../../benchmarks/harness.js";

const context = { Bippy, Source, React, ReactDOM, ReactDOMClient };
const options = { samples: 1, targetMs: 0, maxIterations: 1 };

it("mounts hook fixtures lazily and cleans them before another case runs", async () => {
  const createRoot = vi.fn(ReactDOMClient.createRoot);
  const childCount = document.body.childElementCount;
  const cases = createHookBenchmarks({
    ...context,
    ReactDOMClient: { ...ReactDOMClient, createRoot },
  });
  expect(createRoot).not.toHaveBeenCalled();
  await runBenchmark(cases[0], options);
  expect(createRoot).toHaveBeenCalledOnce();
  expect(document.body.childElementCount).toBe(childCount);
  await runBenchmark(cases[1], options);
  expect(createRoot).toHaveBeenCalledOnce();
  expect(document.body.childElementCount).toBe(childCount);
});

it("cleans mounted fixtures when verification throws", async () => {
  const childCount = document.body.childElementCount;
  const benchmark = createHookBenchmarks(context)[0];
  await expect(
    runBenchmark(
      {
        ...benchmark,
        verify: () => {
          throw new Error("verification failure");
        },
      },
      options,
    ),
  ).rejects.toThrow("verification failure");
  expect(document.body.childElementCount).toBe(childCount);
  await runBenchmark(benchmark, options);
  expect(document.body.childElementCount).toBe(childCount);
});

it("owns DOM lookup fixtures independently, including reversed execution order", async () => {
  const childCount = document.body.childElementCount;
  const createRoot = vi.fn(ReactDOMClient.createRoot);
  const cases = createCoreBenchmarks({
    ...context,
    ReactDOMClient: { ...ReactDOMClient, createRoot },
  }).filter(({ id: benchmarkId }) => benchmarkId.endsWith("/live-dom"));
  expect(createRoot).not.toHaveBeenCalled();
  expect(cases).toHaveLength(2);
  for (const benchmark of cases.reverse()) {
    await runBenchmark(benchmark, options);
    expect(document.body.childElementCount).toBe(childCount);
  }
  expect(createRoot).toHaveBeenCalledTimes(2);
});
