import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readCorpusManifest, type CorpusResult } from "../src/corpus/manifest.js";
import { runCorpusEntry } from "../src/corpus/run-entry.js";
import {
  formatCorpusMarkdown,
  formatCorpusTable,
  mergeCorpusResults,
  type CorpusResultsFile,
} from "../src/corpus/summary.js";
import { BrowserCapturer } from "../src/harness/capture-browser.js";
import { formatComparisonReport } from "../src/harness/format-report.js";

const USAGE = `usage: tsx scripts/corpus.ts [options] [entry-id ...]

  --static-only     render statically; do not install or start dev servers
  --skip-install    assume dependencies are already installed
  --manifest <p>    corpus manifest (default corpus/manifest.json)
  --results <p>     merged results file (default corpus/results.json)
  --markdown <p>    also write a markdown table of all results
  --headed          run the capture browser headed
  --list            print manifest entries and exit`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "static-only": { type: "boolean", default: false },
    "skip-install": { type: "boolean", default: false },
    manifest: { type: "string", default: "corpus/manifest.json" },
    results: { type: "string", default: "corpus/results.json" },
    markdown: { type: "string" },
    headed: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const packageDirectory = path.resolve(import.meta.dirname, "..");
const manifestPath = path.resolve(packageDirectory, values.manifest);
const resultsPath = path.resolve(packageDirectory, values.results);
const corpusDirectory = path.join(packageDirectory, ".corpus");
const manifest = readCorpusManifest(manifestPath);

if (values.list) {
  for (const entry of manifest.entries) {
    console.log(`${entry.id.padEnd(24)} ${entry.framework.padEnd(13)} ${entry.description}`);
  }
  process.exit(0);
}

const selected =
  positionals.length === 0
    ? manifest.entries
    : manifest.entries.filter((entry) => positionals.includes(entry.id));
const unknown = positionals.filter((id) => !manifest.entries.some((entry) => entry.id === id));
if (unknown.length > 0) {
  console.error(`unknown corpus entries: ${unknown.join(", ")}`);
  process.exit(1);
}

const readResults = (): CorpusResult[] => {
  if (!existsSync(resultsPath)) return [];
  const parsed: CorpusResultsFile = JSON.parse(readFileSync(resultsPath, "utf8"));
  return parsed.results;
};

const writeResults = (results: CorpusResult[]): void => {
  mkdirSync(path.dirname(resultsPath), { recursive: true });
  const file: CorpusResultsFile = { results };
  writeFileSync(resultsPath, `${JSON.stringify(file, null, 2)}\n`);
  if (values.markdown) {
    writeFileSync(
      path.resolve(packageDirectory, values.markdown),
      `${formatCorpusMarkdown(results)}\n`,
    );
  }
};

const capturer = new BrowserCapturer({ headless: !values.headed });
const fresh: CorpusResult[] = [];
try {
  for (const entry of selected) {
    const result = await runCorpusEntry(entry, {
      corpusDirectory,
      capturer,
      skipInstall: values["skip-install"],
      staticOnly: values["static-only"],
      log: (message) => console.log(`[${entry.id}] ${message}`),
    });
    fresh.push(result);
    if (result.report) console.log(formatComparisonReport(result.report));
    writeResults(mergeCorpusResults(readResults(), fresh));
  }
} finally {
  await capturer.close();
}

console.log(`\n${formatCorpusTable(fresh)}`);
console.log(`\nresults merged into ${path.relative(process.cwd(), resultsPath)}`);
