import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Expression } from "oxc-parser";
import ts from "typescript";
import type { EvaluationContext } from "../../src/evaluate/context.js";
import { Interpreter } from "../../src/evaluate/interpreter.js";
import { renderFramework } from "../../src/frameworks/render-framework.js";
import { getSourceLocation } from "../../src/parse/source-location.js";
import type { StaticValue } from "../../src/types.js";
import { type TypeClassification, type TypeVerdict, classifyType } from "./classify-type.js";
import { formatMb, formatMs, loadCorpusTargets } from "./corpus-target.js";
import {
  PROGRAM_VARIANTS,
  type ProgramVariant,
  buildProgram,
  findNodeAtSpan,
  getPeakRssMb,
  loadTsconfig,
  timeSync,
} from "./program.js";

export type UncertainKind = "unknown" | "unknown-primitive" | "external-derived" | "condition";

export interface UncertainSite {
  key: string;
  filePath: string;
  line: number;
  column: number;
  start: number;
  end: number;
  nodeType: string;
  kind: UncertainKind;
  reason: string;
  hits: number;
}

export type SiteLookup = "not-in-program" | "no-node" | "inexact" | "exact";

export type CheckerAnswer = "decided" | "narrowed" | "none";

export interface CheckedSite extends UncertainSite {
  lookup: SiteLookup;
  classification: TypeClassification | null;
  answer: CheckerAnswer;
}

export interface AnswerCounts {
  sites: number;
  decided: number;
  narrowed: number;
}

export interface UnknownCoverageSummary {
  entryId: string;
  variant: ProgramVariant;
  renderMs: number;
  renderStats: Record<string, number>;
  programMs: number;
  queryMs: number;
  peakRssMb: number;
  sites: number;
  hits: number;
  byKind: Record<UncertainKind, AnswerCounts>;
  byLookup: Record<SiteLookup, number>;
  byVerdict: Record<TypeVerdict, number>;
  decidedSites: CheckedSite[];
  narrowedSites: CheckedSite[];
  topReasons: ({ reason: string } & AnswerCounts)[];
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "corpus-dir": { type: "string" },
    variant: { type: "string", default: "full" },
    out: { type: "string" },
    examples: { type: "string", default: "60" },
  },
});

const corpusDirectory = path.resolve(values["corpus-dir"] ?? ".corpus");
const variant = PROGRAM_VARIANTS.find((candidate) => candidate === values.variant);
if (!variant) throw new Error(`unknown variant "${values.variant}"`);
const exampleLimit = Number(values.examples);

const sites = new Map<string, UncertainSite>();

const recordSite = (
  context: EvaluationContext,
  node: Expression,
  kind: UncertainKind,
  reason: string,
): void => {
  const key = `${context.module.filePath}:${node.start}:${node.end}:${kind}`;
  const existing = sites.get(key);
  if (existing) {
    existing.hits += 1;
    return;
  }
  const location = getSourceLocation(context.module.file, { start: node.start, end: node.end });
  sites.set(key, {
    key,
    filePath: context.module.filePath,
    line: location.line,
    column: location.column,
    start: node.start,
    end: node.end,
    nodeType: node.type,
    kind,
    reason,
    hits: 1,
  });
};

const recordUncertainResult = (
  context: EvaluationContext,
  node: Expression,
  value: StaticValue,
): void => {
  switch (value.kind) {
    case "unknown":
      recordSite(context, node, "unknown", value.reason);
      return;
    case "unknown-primitive":
      recordSite(context, node, "unknown-primitive", `${value.primitiveType}: ${value.reason}`);
      return;
    case "external":
      if (value.derived)
        recordSite(context, node, "external-derived", `${value.packageName}#${value.importedName}`);
      return;
    case "branch":
      if (node.type === "ConditionalExpression")
        recordSite(context, node.test, "condition", value.reason);
      else if (node.type === "LogicalExpression")
        recordSite(context, node.left, "condition", value.reason);
      return;
    default:
      return;
  }
};

const installInterpreterProbe = (): void => {
  const original = Interpreter.prototype.evaluateExpression;
  Interpreter.prototype.evaluateExpression = function probe(node, context, nameHint) {
    const value = original.call(this, node, context, nameHint);
    recordUncertainResult(context, node, value);
    return value;
  };
};

const answerFor = (site: UncertainSite, classification: TypeClassification): CheckerAnswer => {
  if (site.kind === "condition") return classification.decidesTruthiness ? "decided" : "none";
  if (classification.verdict === "literal") return "decided";
  if (classification.verdict === "literal-union") return "narrowed";
  return "none";
};

const emptyAnswerCounts = (): AnswerCounts => ({ sites: 0, decided: 0, narrowed: 0 });

const countAnswer = (counts: AnswerCounts, answer: CheckerAnswer): void => {
  counts.sites += 1;
  if (answer === "decided") counts.decided += 1;
  if (answer === "narrowed") counts.narrowed += 1;
};

const emptyKindCounts = (): Record<UncertainKind, AnswerCounts> => ({
  unknown: emptyAnswerCounts(),
  "unknown-primitive": emptyAnswerCounts(),
  "external-derived": emptyAnswerCounts(),
  condition: emptyAnswerCounts(),
});

const emptyVerdictCounts = (): Record<TypeVerdict, number> => ({
  literal: 0,
  "literal-union": 0,
  "always-truthy": 0,
  "always-falsy": 0,
  "nullable-object": 0,
  "broad-primitive": 0,
  "broad-object": 0,
  "any-or-unknown": 0,
  error: 0,
});

const checkSites = (program: ts.Program, checker: ts.TypeChecker): CheckedSite[] => {
  const checked: CheckedSite[] = [];
  for (const site of sites.values()) {
    const sourceFile = program.getSourceFile(site.filePath);
    if (!sourceFile) {
      checked.push({ ...site, lookup: "not-in-program", classification: null, answer: "none" });
      continue;
    }
    const match = findNodeAtSpan(sourceFile, site.start, site.end);
    if (!match) {
      checked.push({ ...site, lookup: "no-node", classification: null, answer: "none" });
      continue;
    }
    const classification = classifyType(checker, checker.getTypeAtLocation(match.node));
    checked.push({
      ...site,
      lookup: match.isExact ? "exact" : "inexact",
      classification,
      answer: match.isExact ? answerFor(site, classification) : "none",
    });
  }
  return checked;
};

const summarize = (
  entryId: string,
  checked: CheckedSite[],
  timings: { renderMs: number; programMs: number; queryMs: number },
  renderStats: Record<string, number>,
): UnknownCoverageSummary => {
  const byKind = emptyKindCounts();
  const byLookup: Record<SiteLookup, number> = {
    "not-in-program": 0,
    "no-node": 0,
    inexact: 0,
    exact: 0,
  };
  const byVerdict = emptyVerdictCounts();
  const reasons = new Map<string, AnswerCounts>();
  for (const site of checked) {
    countAnswer(byKind[site.kind], site.answer);
    byLookup[site.lookup] += 1;
    if (site.classification) byVerdict[site.classification.verdict] += 1;
    const reasonKey = `${site.kind}: ${site.reason.replace(/"[^"]*"/g, '"…"')}`;
    const entry = reasons.get(reasonKey) ?? emptyAnswerCounts();
    countAnswer(entry, site.answer);
    reasons.set(reasonKey, entry);
  }
  const sortByHits = (left: CheckedSite, right: CheckedSite): number => right.hits - left.hits;
  return {
    entryId,
    variant,
    ...timings,
    renderStats,
    peakRssMb: getPeakRssMb(),
    sites: checked.length,
    hits: checked.reduce((sum, site) => sum + site.hits, 0),
    byKind,
    byLookup,
    byVerdict,
    decidedSites: checked
      .filter((site) => site.answer === "decided")
      .sort(sortByHits)
      .slice(0, exampleLimit),
    narrowedSites: checked
      .filter((site) => site.answer === "narrowed")
      .sort(sortByHits)
      .slice(0, exampleLimit),
    topReasons: [...reasons.entries()]
      .map(([reason, counts]) => ({ reason, ...counts }))
      .sort((left, right) => right.sites - left.sites)
      .slice(0, 25),
  };
};

const printSummary = (summary: UnknownCoverageSummary): void => {
  console.log(`\n## ${summary.entryId} (${summary.variant} program)`);
  console.log(
    `render ${formatMs(summary.renderMs)}, program+checker ${formatMs(summary.programMs)}, ${summary.sites} uncertain sites queried in ${formatMs(summary.queryMs)}, peak RSS ${formatMb(summary.peakRssMb)}`,
  );
  console.log("render stats", summary.renderStats);
  console.log(
    "\n| kind | distinct sites | decided by checker | narrowed by checker |\n| --- | --- | --- | --- |",
  );
  for (const [kind, counts] of Object.entries(summary.byKind)) {
    console.log(`| ${kind} | ${counts.sites} | ${counts.decided} | ${counts.narrowed} |`);
  }
  console.log("\n| lookup | sites |\n| --- | --- |");
  for (const [lookup, count] of Object.entries(summary.byLookup))
    console.log(`| ${lookup} | ${count} |`);
  console.log("\n| checker verdict | sites |\n| --- | --- |");
  for (const [verdict, count] of Object.entries(summary.byVerdict))
    console.log(`| ${verdict} | ${count} |`);
  console.log("\n| reason | sites | decided | narrowed |\n| --- | --- | --- | --- |");
  for (const reason of summary.topReasons) {
    console.log(
      `| ${reason.reason.replace(/\|/g, "\\|")} | ${reason.sites} | ${reason.decided} | ${reason.narrowed} |`,
    );
  }
  printExamples("decided examples:", summary.decidedSites);
  printExamples("narrowed examples:", summary.narrowedSites);
};

const printExamples = (title: string, examples: CheckedSite[]): void => {
  console.log(`\n${title}`);
  for (const site of examples.slice(0, 20)) {
    console.log(
      `  ${path.relative(corpusDirectory, site.filePath)}:${site.line}:${site.column} [${site.kind}] ${site.reason} -> ${site.classification?.verdict} ${site.classification?.typeText}`,
    );
  }
};

const main = async (): Promise<void> => {
  const ids =
    positionals.length > 0
      ? positionals
      : ["sonner", "react-router-templates", "sentry", "posthog"];
  installInterpreterProbe();
  const summaries: UnknownCoverageSummary[] = [];
  for (const target of loadCorpusTargets(corpusDirectory, ids)) {
    sites.clear();
    const renderStartedAt = performance.now();
    const rendered = await renderFramework(target.entry, target.cloneDirectory);
    const renderMs = performance.now() - renderStartedAt;
    const config = loadTsconfig(target.tsconfigPath);
    const built = timeSync(() => buildProgram(variant, config, target.entryFile));
    const checked = timeSync(() => checkSites(built.result.program, built.result.checker));
    const summary = summarize(
      target.entry.id,
      checked.result,
      { renderMs, programMs: built.elapsedMs, queryMs: checked.elapsedMs },
      { ...rendered.stats },
    );
    summaries.push(summary);
    printSummary(summary);
  }
  if (values.out) {
    mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
    writeFileSync(path.resolve(values.out), JSON.stringify(summaries, null, 2));
  }
};

await main();
