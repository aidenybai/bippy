import { Command } from "commander";
import picocolors from "picocolors";
import {
  countWrongClaims,
  formatMountFailures,
  formatWrongClaims,
  summarizeVerdicts,
} from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { verifyProject } from "./verify.js";

interface CliOptions {
  component?: string[];
  json: boolean;
  setup?: string;
}

const formatVerdict = (verdict: ComponentVerdict): string => {
  if (verdict.status === "not-exported")
    return picocolors.dim(`${verdict.name}  not exported, skipped`);
  if (verdict.status === "mount-failed")
    return `${verdict.name}  ${picocolors.yellow(`couldn't mount (${verdict.mountFailure ?? "other"})`)} ${picocolors.dim(verdict.error ?? "")}`;
  const wrongCount = countWrongClaims(verdict);
  const lines = [
    `${picocolors.bold(verdict.name)}  ${wrongCount > 0 ? picocolors.red(`${wrongCount} wrong`) : picocolors.green("0 wrong")}  ` +
      picocolors.dim(
        `states ${verdict.witnessedStates.length}/${verdict.predictedStates} witnessed · edges ${verdict.witnessedEdges} · branch sides ${verdict.witnessedBranchSides}/${verdict.branchSides} · ${verdict.warnings > 0 ? `warnings ${verdict.witnessedWarnings}/${verdict.warnings} witnessed · ` : ""}${verdict.observations} observations`,
      ),
  ];
  for (const claim of formatWrongClaims(verdict)) lines.push(picocolors.red(`  ✗ ${claim}`));
  for (const unwarned of verdict.unwarnedMutations)
    lines.push(picocolors.dim(`  · unwarned mutation: ${unwarned}`));
  if (verdict.renderErrors > 0)
    lines.push(picocolors.yellow(`  ${verdict.renderErrors} observations threw while rendering`));
  return lines.join("\n");
};

new Command()
  .name("verify")
  .description(
    "Mount each exported component in a real browser, explore it, and check the analyzer's claims against what renders.",
  )
  .argument("<tsconfig>", "path to the project's tsconfig.json")
  .option("-c, --component <names...>", "only verify these components")
  .option("--json", "print the verdicts as JSON", false)
  .option("-s, --setup <directory>", "a verify directory with setup.tsx and harness.json")
  .action(async (tsconfig: string, options: CliOptions) => {
    const report = await verifyProject(tsconfig, {
      componentNames: options.component,
      setupDirectory: options.setup ?? null,
      onComponent: options.json ? undefined : (verdict) => console.log(formatVerdict(verdict)),
      onStart: process.env.VERIFY_DEBUG
        ? (componentName) => console.error(picocolors.dim(`→ ${componentName}`))
        : undefined,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const summary = summarizeVerdicts(report.components, report.durationMs);
    console.log(
      picocolors.dim(
        `\n${summary.verified} verified · ${summary.couldNotMount} couldn't mount${summary.couldNotMount > 0 ? ` (${formatMountFailures(summary.mountFailures)})` : ""} · ${summary.notExported} not exported · ${summary.wrong} wrong · states ${summary.witnessedStates}/${summary.predictedStates} witnessed · warnings ${summary.witnessedWarnings}/${summary.warnings} witnessed · ${summary.unwarnedMutations} unwarned mutations · ${summary.durationMs} ms`,
      ),
    );
  })
  .parseAsync();
