import { createCoreBenchmarks } from "./core.js";
import { createHookBenchmarks } from "./hooks.js";
import { createInstrumentationBenchmarks } from "./instrumentation.js";
import { createSourceBenchmarks } from "./source.js";

export const benchmarkGroups = [
  { name: "core", create: createCoreBenchmarks },
  { name: "instrumentation", create: createInstrumentationBenchmarks },
  { name: "source", create: createSourceBenchmarks },
  { name: "hooks", create: createHookBenchmarks },
];
