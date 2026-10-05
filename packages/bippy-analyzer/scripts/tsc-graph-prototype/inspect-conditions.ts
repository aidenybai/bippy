import path from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";
import { classifyType } from "./classify-type.js";
import { formatMs, loadCorpusTargets } from "./corpus-target.js";
import { PROGRAM_VARIANTS, buildProgram, loadTsconfig } from "./program.js";

export interface ConditionProbe {
  relativeFilePath: string;
  line: number;
  snippet: string;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "corpus-dir": { type: "string" },
    variant: { type: "string", default: "reachable" },
  },
});

const corpusDirectory = path.resolve(values["corpus-dir"] ?? ".corpus");
const variant = PROGRAM_VARIANTS.find((candidate) => candidate === values.variant);
if (!variant) throw new Error(`unknown variant "${values.variant}"`);
const [entryId, ...probeArgs] = positionals;
if (!entryId || probeArgs.length === 0) {
  console.error(
    "usage: tsx inspect-conditions.ts --corpus-dir <dir> <entry-id> <relative-file>:<line>:<expression snippet>...",
  );
  process.exit(1);
}

const parseProbe = (probeArg: string): ConditionProbe => {
  const match = /^([^:]+):(\d+):(.+)$/.exec(probeArg);
  if (!match) throw new Error(`bad probe "${probeArg}"`);
  return { relativeFilePath: match[1], line: Number(match[2]), snippet: match[3] };
};

const findSnippetNode = (sourceFile: ts.SourceFile, probe: ConditionProbe): ts.Node | null => {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    if (line + 1 === probe.line && node.getText(sourceFile) === probe.snippet) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const describeSymbolOrigin = (checker: ts.TypeChecker, node: ts.Node): string => {
  const symbol = checker.getSymbolAtLocation(node);
  const declaration = symbol?.declarations?.[0];
  if (!declaration) return "";
  const declarationFile = declaration.getSourceFile();
  const { line } = declarationFile.getLineAndCharacterOfPosition(
    declaration.getStart(declarationFile),
  );
  return ` declared at ${path.relative(corpusDirectory, declarationFile.fileName)}:${line + 1}`;
};

const [target] = loadCorpusTargets(corpusDirectory, [entryId]);
const config = loadTsconfig(target.tsconfigPath);
const build = buildProgram(variant, config, target.entryFile);
console.log(
  `${entryId}: ${variant} program with ${build.counts.total} source files in ${formatMs(build.createProgramMs + build.createCheckerMs)}\n`,
);
console.log("| site | expression | checker type | verdict |\n| --- | --- | --- | --- |");
for (const probe of probeArgs.map(parseProbe)) {
  const filePath = path.join(target.cloneDirectory, probe.relativeFilePath);
  const sourceFile = build.program.getSourceFile(filePath);
  const site = `${probe.relativeFilePath}:${probe.line}`;
  if (!sourceFile) {
    console.log(`| ${site} | \`${probe.snippet}\` | not in program | - |`);
    continue;
  }
  const node = findSnippetNode(sourceFile, probe);
  if (!node) {
    console.log(`| ${site} | \`${probe.snippet}\` | snippet not found on that line | - |`);
    continue;
  }
  const classification = classifyType(build.checker, build.checker.getTypeAtLocation(node));
  console.log(
    `| ${site} | \`${probe.snippet}\` | \`${classification.typeText}\`${describeSymbolOrigin(build.checker, node)} | ${classification.verdict}${classification.decidesTruthiness ? " (decides truthiness)" : ""} |`,
  );
}
