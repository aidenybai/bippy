import { relative, resolve } from "node:path";
import { Command } from "commander";
import { compareProject } from "./compare.js";
import type { FunctionComparison } from "./compare.js";

interface CompilerDiffCliOptions {
  file?: string;
  typeProvider: boolean;
  diffs: boolean;
}

const countBy = <Key extends string>(
  items: FunctionComparison[],
  getKeys: (item: FunctionComparison) => Key[],
): Map<Key, number> => {
  const counts = new Map<Key, number>();
  for (const item of items)
    for (const key of getKeys(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
};

const formatPercent = (count: number, total: number): string =>
  total === 0 ? "n/a" : `${((count / total) * 100).toFixed(1)}%`;

const run = (tsconfig: string, options: CompilerDiffCliOptions): void => {
  const configPath = resolve(tsconfig);
  const comparisons = compareProject(configPath, {
    fileFilter: options.file ?? null,
    isTypeProviderEnabled: options.typeProvider,
  });
  const root = resolve(configPath, "..");
  for (const comparison of comparisons) {
    if (comparison.status === "match") continue;
    const location = `${relative(root, comparison.file)}:${comparison.key}`;
    const detail = [
      comparison.categories.join(", "),
      comparison.portError && `port: ${comparison.portError}`,
      comparison.upstreamErrors.length > 0 && `upstream: ${comparison.upstreamErrors.join("; ")}`,
    ]
      .filter(Boolean)
      .join(" | ");
    console.log(
      `${comparison.status} ${comparison.name} ${location}${detail ? ` (${detail})` : ""}`,
    );
    if (options.diffs && comparison.patch) console.log(comparison.patch);
  }
  const compared = comparisons.filter(
    (comparison) => comparison.status === "match" || comparison.status === "mismatch",
  );
  const matched = compared.filter((comparison) => comparison.status === "match");
  const files = [...new Set(compared.map((comparison) => comparison.file))];
  const matchedFiles = files.filter((file) =>
    compared.every((comparison) => comparison.file !== file || comparison.status === "match"),
  );
  console.log();
  console.log(
    `functions: ${matched.length}/${compared.length} match (${formatPercent(matched.length, compared.length)})`,
  );
  console.log(
    `files: ${matchedFiles.length}/${files.length} match (${formatPercent(matchedFiles.length, files.length)})`,
  );
  console.log(
    `statuses: ${[...countBy(comparisons, (comparison) => [comparison.status])]
      .map(([status, count]) => `${status}=${count}`)
      .join(" ")}`,
  );
  console.log(
    `categories: ${[...countBy(comparisons, (comparison) => comparison.categories)]
      .map(([category, count]) => `${category}=${count}`)
      .join(" ")}`,
  );
};

new Command()
  .name("compiler-diff")
  .description(
    "Compare our compiler port's HIR after InferReactivePlaces with babel-plugin-react-compiler's.",
  )
  .argument("<tsconfig>", "path to the project's tsconfig.json")
  .option("-f, --file <filter>", "only files whose path contains this text")
  .option(
    "--type-provider",
    "seed type inference with TypeScript types, as our pipeline does",
    false,
  )
  .option("--no-diffs", "print only the summary of each mismatch")
  .action(run)
  .parse();
