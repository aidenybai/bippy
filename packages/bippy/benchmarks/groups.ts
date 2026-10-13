import { createCoreBenchmarks } from "./core";
import { createHookBenchmarks } from "./hooks";
import { createInstrumentationBenchmarks } from "./instrumentation";
import { createSourceBenchmarks } from "./source";

export const benchmarkGroups = [
  { name: "core", create: createCoreBenchmarks },
  { name: "instrumentation", create: createInstrumentationBenchmarks },
  { name: "source", create: createSourceBenchmarks },
  { name: "hooks", create: createHookBenchmarks },
];
