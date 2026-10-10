import { Command } from "commander";
import picocolors from "picocolors";
import type { Sample } from "../../src/symbolic-tree/model.ts";
import type { ComponentVerdict } from "./score.ts";
import { verifyProject } from "./verify.ts";

interface CliOptions {
  component?: string[];
  json: boolean;
}

const formatSample = (sample: Sample): string => {
  if (sample.kind === "value") return JSON.stringify(sample.value);
  if (sample.kind === "array") return `[${sample.items.map(formatSample).join(", ")}]`;
  if (sample.kind === "object") return "{…}";
  return sample.kind === "function" ? "fn" : "undefined";
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, 160) || "none";

const formatVerdict = (verdict: ComponentVerdict): string => {
  const { colors } = { colors: picocolors };
  if (verdict.status === "not-exported")
    return colors.dim(`${verdict.name}  not exported, skipped`);
  if (verdict.status === "mount-failed")
    return `${verdict.name}  ${colors.yellow("couldn't mount")} ${colors.dim(verdict.error ?? "")}`;
  const wrongCount =
    verdict.wrongStates.length +
    verdict.wrongEdges.length +
    verdict.wrongValues.length +
    verdict.refutedDeadClaims.length;
  const lines = [
    `${colors.bold(verdict.name)}  ${wrongCount > 0 ? colors.red(`${wrongCount} wrong`) : colors.green("0 wrong")}  ` +
      colors.dim(
        `states ${verdict.witnessedStates.length}/${verdict.predictedStates} witnessed · edges ${verdict.witnessedEdges} · branch sides ${verdict.witnessedBranchSides}/${verdict.branchSides} · ${verdict.observations} observations`,
      ),
  ];
  for (const wrongState of verdict.wrongStates) {
    lines.push(
      colors.red(
        `  ✗ unpredicted state after [${wrongState.path.join(" → ") || "mount"}] props ${formatProps(wrongState.props)}`,
      ),
    );
    lines.push(colors.dim(`    rendered ${wrongState.rendered}`));
    lines.push(colors.dim(`    closest S${wrongState.closestState + 1}`));
  }
  for (const wrongEdge of verdict.wrongEdges) {
    lines.push(
      colors.red(
        `  ✗ ${wrongEdge.reason}: ${wrongEdge.action} went S${wrongEdge.fromStates.map((state) => state + 1).join("|S")} → S${wrongEdge.toStates.map((state) => state + 1).join("|S")}`,
      ),
    );
  }
  for (const wrongValue of verdict.wrongValues) {
    lines.push(
      colors.red(
        `  ✗ ${wrongValue.atom} = ${wrongValue.value}, predicted ${wrongValue.predicted.join(" | ")}`,
      ),
    );
  }
  for (const refuted of verdict.refutedDeadClaims)
    lines.push(colors.red(`  ✗ dead branch was reached: ${refuted}`));
  if (verdict.renderErrors > 0)
    lines.push(colors.yellow(`  ${verdict.renderErrors} observations threw while rendering`));
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
      ...(options.component ? { componentNames: options.component } : {}),
      ...(options.json
        ? {}
        : { onComponent: (verdict: ComponentVerdict) => console.log(formatVerdict(verdict)) }),
      ...(process.env.VERIFY_DEBUG
        ? {
            onStart: (componentName: string) => console.error(picocolors.dim(`→ ${componentName}`)),
          }
        : {}),
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const verified = report.components.filter((verdict) => verdict.status === "verified");
    const wrong = verified.reduce(
      (total, verdict) =>
        total +
        verdict.wrongStates.length +
        verdict.wrongEdges.length +
        verdict.wrongValues.length +
        verdict.refutedDeadClaims.length,
      0,
    );
    const predicted = verified.reduce((total, verdict) => total + verdict.predictedStates, 0);
    const witnessed = verified.reduce(
      (total, verdict) => total + verdict.witnessedStates.length,
      0,
    );
    console.log(
      picocolors.dim(
        `\n${verified.length} verified · ${report.components.filter((verdict) => verdict.status === "mount-failed").length} couldn't mount · ${report.components.filter((verdict) => verdict.status === "not-exported").length} not exported · ${wrong} wrong · states ${witnessed}/${predicted} witnessed · ${report.durationMs} ms`,
      ),
    );
  })
  .parseAsync();
