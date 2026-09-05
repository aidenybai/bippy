import { afterEach, expect, it, vi } from "vite-plus/test";
import { benchmarkCase, runBenchmark } from "../../benchmarks/harness.js";
import { verifyBenchmarkCoverage, verifyWorkerReport } from "../../benchmarks/report.js";

afterEach(() => vi.restoreAllMocks());

it("excludes setup and verification from timed batches", async () => {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const result = await runBenchmark(
    benchmarkCase(
      "sync",
      [],
      () => {
        clock++;
        return 1;
      },
      (value) => {
        expect(value).toBe(1);
        clock += 1000;
      },
      {
        prepare: () => {
          clock += 1000;
        },
      },
    ),
    { samples: 3, targetMs: 0, maxIterations: 4 },
  );
  expect(result.iterations).toBe(1);
  expect(result.sampleUs).toEqual([1000, 1000, 1000]);
  expect(result.medianUs).toBe(1000);
});

it("awaits async work and validates every batch result", async () => {
  const verify = vi.fn((value) => expect(value).toBe("complete"));
  const cleanup = vi.fn();
  const result = await runBenchmark(
    benchmarkCase(
      "async",
      [],
      async () => {
        await Promise.resolve();
        return "complete";
      },
      verify,
      { async: true, cleanup },
    ),
    { samples: 2, targetMs: 0, maxIterations: 1 },
  );
  expect(result.samples).toBe(2);
  expect(verify).toHaveBeenCalledTimes(4);
  expect(cleanup).toHaveBeenCalledOnce();
});

it("rejects incorrectly declared async benchmarks and still cleans up", async () => {
  const cleanup = vi.fn();
  await expect(
    runBenchmark(
      benchmarkCase(
        "incorrect",
        [],
        () => Promise.resolve(1),
        () => {},
        { cleanup },
      ),
      {
        samples: 1,
        targetMs: 0,
        maxIterations: 1,
      },
    ),
  ).rejects.toThrow("incorrect async declaration");
  expect(cleanup).toHaveBeenCalledOnce();
});

it("calibrates up to the allocation cap without including setup", async () => {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const result = await runBenchmark(
    benchmarkCase(
      "capped",
      [],
      () => {
        clock += 0.1;
        return true;
      },
      () => {},
      { maxIterations: 4 },
    ),
    {
      samples: 1,
      targetMs: 10,
      maxIterations: 100,
    },
  );
  expect(result.iterations).toBe(4);
  expect(result.medianUs).toBeCloseTo(100);
});

it("fails coverage accounting for missing or invented callable exports", () => {
  const inventory = [{ entry: "bippy", callable: ["useFiber"], data: ["version"] }];
  expect(() => verifyBenchmarkCoverage(inventory, new Set())).toThrow();
  expect(() => verifyBenchmarkCoverage(inventory, new Set(["bippy#invented"]))).toThrow();
  expect(() => verifyBenchmarkCoverage(inventory, new Set(["bippy#useFiber"]))).not.toThrow();
});

it("rejects invalid measurement reports", () => {
  expect(() =>
    verifyWorkerReport({
      group: "empty",
      format: "esm",
      reactBuild: "production",
      reactVersion: "19",
      exports: [],
      results: [],
      maxRssBytes: 0,
    }),
  ).toThrow("Empty benchmark group");
});
