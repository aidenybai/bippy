import { runUseFiberBenchmarks } from "../benchmarks/use-fiber.js";
import { writeReport } from "../benchmarks/report.js";

const isQuickMode = process.argv.includes("--quick");
const format = process.argv.includes("--cjs") ? "cjs" : "esm";
const report = runUseFiberBenchmarks(format, isQuickMode, (result) => {
  console.log(
    `${format}/${result.react}: ${result.components} components, ${result.precedingHooks} preceding refs verified`,
  );
});
writeReport(report);
