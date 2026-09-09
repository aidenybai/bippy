import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readCorpusManifest, type CorpusResult } from "../src/corpus/manifest.js";
import {
  ensureClone,
  ensureInstalled,
  installLogPath,
  runCorpusEntry,
} from "../src/corpus/run-entry.js";
import {
  formatCorpusMarkdown,
  formatCorpusTable,
  mergeCorpusResults,
  readCorpusResults,
  type CorpusResultsFile,
} from "../src/corpus/summary.js";
import { BrowserCapturer } from "../src/harness/capture-browser.js";
import { formatComparisonReport } from "../src/harness/format-report.js";

const USAGE = `usage: tsx scripts/corpus.ts [options] [entry-id ...]

  --static-only     render statically; do not install or start dev servers
  --skip-install    assume dependencies are already installed
  --install-only    clone and install the selected entries, then exit
  --parallel <n>    install this many entries concurrently (default 1)
  --manifest <p>    corpus manifest (default corpus/manifest.json)
  --results <p>     merged results file (default corpus/results.json)
  --markdown <p>    also write a markdown table of all results
  --corpus-dir <p>  where repositories are cloned (default .corpus; keep it outside
                    this monorepo for tools that walk up to the nearest workspace root)
  --headed          run the capture browser headed
  --list            print manifest entries and exit`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "static-only": { type: "boolean", default: false },
    "corpus-dir": { type: "string", default: ".corpus" },
    "skip-install": { type: "boolean", default: false },
    "install-only": { type: "boolean", default: false },
    parallel: { type: "string", default: "1" },
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
const corpusDirectory = path.resolve(packageDirectory, values["corpus-dir"]);
const manifest = readCorpusManifest(manifestPath);
const scriptsDirectory = path.join(path.dirname(manifestPath), "scripts");

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

const readResults = (): CorpusResult[] =>
  existsSync(resultsPath) ? readCorpusResults(resultsPath).results : [];

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

if (values["install-only"]) {
  const queue = [...selected];
  const failures: string[] = [];
  const worker = async (): Promise<void> => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const log = (message: string) => console.log(`[${entry.id}] ${message}`);
      try {
        const cloneDirectory = ensureClone(entry, corpusDirectory, log);
        await ensureInstalled(
          entry,
          cloneDirectory,
          scriptsDirectory,
          installLogPath(corpusDirectory, entry),
          log,
        );
        log("installed");
      } catch (error) {
        failures.push(entry.id);
        log(`install failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const parallel = Math.max(1, Number.parseInt(values.parallel, 10) || 1);
  await Promise.all(Array.from({ length: parallel }, worker));
  if (failures.length > 0) console.error(`install failures: ${failures.join(", ")}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

const capturer = new BrowserCapturer({ headless: !values.headed });
const fresh: CorpusResult[] = [];
try {
  for (const entry of selected) {
    const result = await runCorpusEntry(entry, {
      corpusDirectory,
      scriptsDirectory,
      capturer,
      skipInstall: values["skip-install"],
      staticOnly: values["static-only"],
      log: (message) => console.log(`[${entry.id}] ${message}`),
    });
    fresh.push(result);
    if (result.report) console.log(formatComparisonReport(result.report, result.stateSpace));
    writeResults(mergeCorpusResults(readResults(), fresh));
  }
} finally {
  await capturer.close();
}

console.log(`\n${formatCorpusTable(fresh)}`);
console.log(`\nresults merged into ${path.relative(process.cwd(), resultsPath)}`);
// HACK: the scheduler of React 16/17 keeps a MessageChannel port open, holding the process alive after the work is done.
process.exit(0);
