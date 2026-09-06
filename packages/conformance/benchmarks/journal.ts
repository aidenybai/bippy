import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatBenchmarkReport, type BenchmarkRunReport, type RunMetadata } from "./report.js";

export interface JournalEntry {
  kind: "metadata" | "worker" | "import" | "useFiber" | "complete";
  data: unknown;
}

export const createBenchmarkJournal = (outputDirectory: URL, metadata: RunMetadata) => {
  mkdirSync(outputDirectory, { recursive: true });
  const directory = pathToFileURL(mkdtempSync(join(fileURLToPath(outputDirectory), "run-")) + "/");
  const progress = new URL("progress.jsonl", directory);
  const append = (entry: JournalEntry): void =>
    appendFileSync(progress, JSON.stringify(entry) + "\n");
  append({ kind: "metadata", data: metadata });
  const complete = (report: BenchmarkRunReport): void => {
    const name = metadata.isQuickMode ? "smoke" : "latest";
    const json = JSON.stringify(report, null, 2) + "\n";
    const markdown = formatBenchmarkReport(report);
    writeFileSync(new URL("report.json", directory), json);
    writeFileSync(new URL("report.md", directory), markdown);
    for (const [extension, content] of [
      ["json", json],
      ["md", markdown],
    ]) {
      const temporary = new URL(`${name}.${extension}.tmp`, directory);
      writeFileSync(temporary, content);
      renameSync(temporary, new URL(`${name}.${extension}`, outputDirectory));
    }
    append({ kind: "complete", data: { json: "report.json", markdown: "report.md" } });
  };
  return { directory, progress, append, complete };
};
