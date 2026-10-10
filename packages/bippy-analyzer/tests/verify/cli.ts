import { Command } from "commander";
import picocolors from "picocolors";
import type { Sample } from "../../src/core/inference/types.js";
import { countWrongClaims, summarizeVerdicts } from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { verifyProject } from "./verify.js";

interface CliOptions {
  component?: string[];
  json: boolean;
}

const formatSample = (sample: Sample): string => {
  if (sample.kind === "Value") return JSON.stringify(sample.value);
  if (sample.kind === "Array") return `[${sample.items.map(formatSample).join(", ")}]`;
  if (sample.kind === "Object") return "{…}";
  return sample.kind === "Function" ? "fn" : "undefined";
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "Undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, 160) || "none";

const formatStates = (states: number[]): string => states.map((state) => `S${state + 1}`).join("|");

const formatVerdict = (verdict: ComponentVerdict): string => {
  if (verdict.status === "not-exported")
    return picocolors.dim(`${verdict.name}  not exported, skipped`);
  if (verdict.status === "mount-failed")
    return `${verdict.name}  ${picocolors.yellow("couldn't mount")} ${picocolors.dim(verdict.error ?? "")}`;
  const wrongCount = countWrongClaims(verdict);
  const lines = [
    `${picocolors.bold(verdict.name)}  ${wrongCount > 0 ? picocolors.red(`${wrongCount} wrong`) : picocolors.green("0 wrong")}  ` +
      picocolors.dim(
        `states ${verdict.witnessedStates.length}/${verdict.predictedStates} witnessed · edges ${verdict.witnessedEdges} · branch sides ${verdict.witnessedBranchSides}/${verdict.branchSides} · ${verdict.warnings > 0 ? `warnings ${verdict.witnessedWarnings}/${verdict.warnings} witnessed · ` : ""}${verdict.observations} observations`,
      ),
  ];
  for (const wrongState of verdict.wrongStates) {
    lines.push(
      picocolors.red(
        `  ✗ unpredicted state after [${wrongState.path.join(" → ") || "mount"}] props ${formatProps(wrongState.props)}`,
      ),
    );
    lines.push(picocolors.dim(`    rendered ${wrongState.rendered}`));
    lines.push(picocolors.dim(`    closest ${formatStates([wrongState.closestState])}`));
  }
  for (const wrongEdge of verdict.wrongEdges) {
    lines.push(
      picocolors.red(
        `  ✗ ${wrongEdge.reason}: ${wrongEdge.action} went ${formatStates(wrongEdge.fromStates)} → ${formatStates(wrongEdge.toStates)}`,
      ),
    );
  }
  for (const wrongValue of verdict.wrongValues) {
    lines.push(
      picocolors.red(
        `  ✗ ${wrongValue.place} = ${wrongValue.value}, predicted ${wrongValue.predicted.join(" | ")}`,
      ),
    );
  }
  for (const refuted of verdict.refutedDeadClaims)
    lines.push(picocolors.red(`  ✗ dead branch was reached: ${refuted}`));
  for (const refuted of verdict.refutedWarnings)
    lines.push(picocolors.red(`  ✗ mutation warning refuted: ${refuted}`));
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
  .action(async (tsconfig: string, options: CliOptions) => {
    const report = await verifyProject(tsconfig, {
      componentNames: options.component,
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
        `\n${summary.verified} verified · ${summary.couldNotMount} couldn't mount · ${summary.notExported} not exported · ${summary.wrong} wrong · states ${summary.witnessedStates}/${summary.predictedStates} witnessed · warnings ${summary.witnessedWarnings}/${summary.warnings} witnessed · ${summary.unwarnedMutations} unwarned mutations · ${summary.durationMs} ms`,
      ),
    );
  })
  .parseAsync();
