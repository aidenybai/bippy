import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildCaptureScript,
  checkoutRepository,
  CORPUS_REPOSITORIES,
  type CorpusCheckout,
  type CorpusEntryResult,
  type CorpusReport,
  DEFAULT_SCAN_OPTIONS,
  formatCorpusReport,
  scanCheckout,
  toWorkspaceCheckout,
  verifyLive,
  WORKSPACE_APPS,
  writeCorpusReport,
} from "../src/corpus/index.js";

const USAGE = `usage: pnpm corpus [options] [name...]

  name                 repository slug (owner/name) or workspace app name;
                       defaults to every repository
  --workspace          also include the fixture apps of this monorepo
  --live               boot dev servers and compare with what the browser renders
  --no-scan            skip the static scan
  --externals          link into node_modules (default: off for scans, on for live)
  --max-components <n> stop scanning a repository after n components
  --cache <dir>        clone directory (default: packages/parser/.corpus/repos)
  --links <dir>        workspace package links (default: packages/parser/.corpus/links)
  --out <dir>          report directory (default: packages/parser/.corpus/report)
  --update             fetch the branch tip again for existing clones
  --offline            never clone or fetch`;

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(packageDirectory, "../..");
const corpusDirectory = resolve(packageDirectory, ".corpus");

/** A whole app is one tree, so it gets a larger budget than a scanned component. */
const LIVE_MAX_FIBER_COUNT = 50_000;
const LIVE_TIME_BUDGET_MS = 120_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    workspace: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    scan: { type: "boolean", default: true },
    externals: { type: "boolean" },
    "max-components": { type: "string", default: "0" },
    cache: { type: "string", default: resolve(corpusDirectory, "repos") },
    links: { type: "string", default: resolve(corpusDirectory, "links") },
    out: { type: "string", default: resolve(corpusDirectory, "report") },
    update: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const log = (name: string, message: string): void => {
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${name}: ${message}`);
};

interface Selection {
  name: string;
  getCheckout: () => Promise<CorpusCheckout>;
}

const selectEntries = (): Selection[] => {
  const requested = new Set(positionals);
  const isRequested = (name: string): boolean => requested.size === 0 || requested.has(name);
  const repositories: Selection[] = CORPUS_REPOSITORIES.filter((repository) =>
    isRequested(repository.slug),
  ).map((repository) => ({
    name: repository.slug,
    getCheckout: () =>
      checkoutRepository(repository, {
        cacheDirectory: values.cache,
        linksDirectory: values.links,
        update: values.update,
        offline: values.offline,
      }),
  }));
  const apps: Selection[] = WORKSPACE_APPS.filter(
    (app) => requested.has(app.name) || (values.workspace && requested.size === 0),
  ).map((app) => ({
    name: app.name,
    getCheckout: () => Promise.resolve(toWorkspaceCheckout(app, monorepoRoot)),
  }));
  const selected = [...repositories, ...apps];
  const unknownNames = positionals.filter(
    (name) => !selected.some((selection) => selection.name === name),
  );
  if (unknownNames.length > 0) {
    console.error(`unknown corpus entries: ${unknownNames.join(", ")}\n\n${USAGE}`);
    process.exit(1);
  }
  return selected;
};

const runEntry = async (
  selection: Selection,
  captureScriptPath: string | null,
): Promise<CorpusEntryResult> => {
  const result: CorpusEntryResult = { name: selection.name, scan: null, live: null, error: null };
  let checkout: CorpusCheckout;
  try {
    log(selection.name, "checking out");
    checkout = await selection.getCheckout();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log(selection.name, `checkout failed: ${result.error}`);
    return result;
  }
  if (values.scan) {
    log(selection.name, `scanning ${checkout.appDirectory}`);
    result.scan = scanCheckout(checkout, {
      ...DEFAULT_SCAN_OPTIONS,
      followExternalModules: values.externals ?? false,
      maxComponents: Number(values["max-components"]),
      onProgress: (message) => log(selection.name, message),
    });
    const { components } = result.scan;
    log(
      selection.name,
      `${components.rendered} components rendered, ${components.crashed} crashed, ${components.fibers} fibers, ${components.unknowns} unknown, ${components.opaque} opaque`,
    );
  }
  if (captureScriptPath && checkout.live) {
    result.live = await verifyLive(checkout, {
      captureScriptPath,
      followExternalModules: values.externals ?? true,
      maxFiberCount: LIVE_MAX_FIBER_COUNT,
      timeBudgetMs: LIVE_TIME_BUDGET_MS,
      onLog: (message) => log(selection.name, message),
    });
    const { report, error } = result.live;
    log(
      selection.name,
      error
        ? `live failed: ${error}`
        : report
          ? `live ${report.isMatch ? "match" : "MISMATCH"}, coverage ${(report.coverage * 100).toFixed(1)}%`
          : "live produced no report",
    );
  } else if (values.live) {
    log(selection.name, "no live target");
  }
  return result;
};

const main = async (): Promise<void> => {
  const selections = selectEntries();
  const captureScriptPath = values.live
    ? await buildCaptureScript(resolve(corpusDirectory, "capture"))
    : null;
  const report: CorpusReport = { generatedAt: new Date().toISOString(), entries: [] };
  for (const selection of selections) {
    report.entries.push(await runEntry(selection, captureScriptPath));
    writeCorpusReport(report, values.out);
  }
  console.log(formatCorpusReport(report).split("\n## ")[0]);
  console.error(`\nreport written to ${values.out}`);
};

await main();
