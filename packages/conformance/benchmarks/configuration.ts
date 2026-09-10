import assert from "node:assert/strict";

export interface BenchmarkVariant {
  format: "esm" | "cjs";
  reactBuild: "development" | "production";
}

export const benchmarkFormats: BenchmarkVariant["format"][] = ["esm", "cjs"];
export const benchmarkBuilds: BenchmarkVariant["reactBuild"][] = ["development", "production"];

export const getBenchmarkVariant = (format: unknown, reactBuild: unknown): BenchmarkVariant => {
  assert.ok(format === "esm" || format === "cjs", "Invalid bundle format");
  assert.ok(reactBuild === "development" || reactBuild === "production", "Invalid React build");
  return { format, reactBuild };
};
