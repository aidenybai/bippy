import assert from "node:assert/strict";
import { getSampleStatistics } from "./statistics.js";

export interface BenchmarkCase {
  id: string;
  apis: string[];
  run: (iteration: number) => unknown;
  verify: (value: unknown) => void;
  prepare?: (iterations: number) => void | Promise<void>;
  cleanup?: () => void | Promise<void>;
  isAsync?: boolean;
  maxIterations?: number;
  units?: number;
}

export interface BenchmarkOptions {
  samples: number;
  targetMs: number;
  maxIterations: number;
}

export interface BenchmarkResult {
  id: string;
  apis: string[];
  iterations: number;
  samples: number;
  units: number;
  medianUs: number;
  minUs: number;
  maxUs: number;
  sampleUs: number[];
}

export interface BenchmarkContext {
  Bippy: typeof import("bippy");
  Source: typeof import("bippy/source");
  React: typeof import("react");
  ReactDOM: typeof import("react-dom");
  ReactDOMClient: typeof import("react-dom/client");
}

const resultsSink: unknown[] = Array.from({ length: 256 });

const measureSync = (benchmark: BenchmarkCase, iterations: number): number => {
  const start = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    resultsSink[iteration % resultsSink.length] = benchmark.run(iteration);
  }
  return performance.now() - start;
};

const measureAsync = async (benchmark: BenchmarkCase, iterations: number): Promise<number> => {
  const start = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    resultsSink[iteration % resultsSink.length] = await benchmark.run(iteration);
  }
  return performance.now() - start;
};

export const runBenchmark = async (
  benchmark: BenchmarkCase,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> => {
  assert.ok(options.samples > 0 && Number.isInteger(options.samples));
  assert.ok(options.targetMs >= 0 && Number.isFinite(options.targetMs));
  assert.ok(options.maxIterations > 0 && Number.isInteger(options.maxIterations));
  const limit = Math.min(options.maxIterations, benchmark.maxIterations ?? options.maxIterations);
  assert.ok(limit > 0 && Number.isInteger(limit));
  const measure = async (iterations: number): Promise<number> => {
    resultsSink.fill(undefined);
    // HACK: Yield between batches so WeakRef targets from the previous batch can be collected.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await benchmark.prepare?.(iterations);
    const elapsed = benchmark.isAsync
      ? await measureAsync(benchmark, iterations)
      : measureSync(benchmark, iterations);
    benchmark.verify(resultsSink[(iterations - 1) % resultsSink.length]);
    return elapsed;
  };
  try {
    await benchmark.prepare?.(1);
    const initialValue = benchmark.run(0);
    const isAsync =
      initialValue !== null &&
      (typeof initialValue === "object" || typeof initialValue === "function") &&
      typeof Reflect.get(initialValue, "then") === "function";
    assert.equal(
      isAsync,
      Boolean(benchmark.isAsync),
      `${benchmark.id}: incorrect async declaration`,
    );
    benchmark.verify(await initialValue);
    let iterations = 1;
    while (true) {
      const elapsed = await measure(iterations);
      if (elapsed >= options.targetMs || iterations >= limit) break;
      iterations = Math.min(limit, iterations * 4);
    }
    const sampleUs: number[] = [];
    for (let sample = 0; sample < options.samples; sample++) {
      sampleUs.push(((await measure(iterations)) * 1000) / iterations);
    }
    const statistics = getSampleStatistics(sampleUs);
    return {
      id: benchmark.id,
      apis: benchmark.apis,
      units: benchmark.units ?? 1,
      iterations,
      samples: options.samples,
      medianUs: statistics.median,
      minUs: statistics.min,
      maxUs: statistics.max,
      sampleUs,
    };
  } finally {
    resultsSink.fill(undefined);
    await benchmark.cleanup?.();
  }
};

export const benchmarkCase = (
  benchmarkId: string,
  apis: string[],
  run: BenchmarkCase["run"],
  verify: BenchmarkCase["verify"],
  options: Partial<
    Pick<BenchmarkCase, "prepare" | "cleanup" | "isAsync" | "maxIterations" | "units">
  > = {},
): BenchmarkCase => ({ id: benchmarkId, apis, run, verify, ...options });

export const equals =
  (expected: unknown) =>
  (actual: unknown): void =>
    assert.equal(actual, expected);

export const createBenchmarkSuite = (entry: string) => {
  const cases: BenchmarkCase[] = [];
  const add = (
    name: string,
    scenario: string,
    run: BenchmarkCase["run"],
    verify: BenchmarkCase["verify"],
    isAsync = false,
  ): void => {
    cases.push(
      benchmarkCase(`${name}/${scenario}`, [`${entry}#${name}`], run, verify, { isAsync }),
    );
  };
  return { cases, add };
};
