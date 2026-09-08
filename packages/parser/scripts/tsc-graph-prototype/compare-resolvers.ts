import { realpathSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";
import { ModuleResolver } from "../../src/graph/module-resolver.js";
import type { ModuleResolution } from "../../src/types.js";
import { formatMs, loadCorpusTargets } from "./corpus-target.js";
import { isNodeModulesFile, loadTsconfig, timeSync } from "./program.js";

export type ResolverAgreement =
  | "same-file"
  | "both-external"
  | "both-unresolved"
  | "tsc-declaration-only"
  | "tsc-unresolved-only"
  | "oxc-unresolved-only"
  | "same-file-different-kind"
  | "different-file";

export interface ResolverDisagreement {
  kind: ResolverAgreement;
  from: string;
  specifier: string;
  tsc: string;
  oxc: string;
}

export interface ResolverComparison {
  entryId: string;
  sourceFiles: number;
  specifiers: number;
  tscMs: number;
  oxcMs: number;
  agreement: Record<ResolverAgreement, number>;
  disagreements: ResolverDisagreement[];
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "corpus-dir": { type: "string" } },
});

const corpusDirectory = path.resolve(values["corpus-dir"] ?? ".corpus");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const EXAMPLES_PER_KIND = 12;
const EXAMPLE_KINDS = new Set<ResolverAgreement>([
  "different-file",
  "same-file-different-kind",
  "oxc-unresolved-only",
  "tsc-unresolved-only",
]);

const collectSpecifiers = (fileNames: string[]): { from: string; specifier: string }[] => {
  const collected: { from: string; specifier: string }[] = [];
  for (const fileName of fileNames) {
    if (!SOURCE_EXTENSIONS.has(path.extname(fileName)) || fileName.endsWith(".d.ts")) continue;
    const text = ts.sys.readFile(fileName);
    if (text === undefined) continue;
    const info = ts.preProcessFile(text, true, true);
    for (const imported of info.importedFiles)
      collected.push({ from: fileName, specifier: imported.fileName });
  }
  return collected;
};

const describeTsc = (resolved: ts.ResolvedModuleFull | undefined): string => {
  if (!resolved) return "unresolved";
  const realPath = realpathSync(resolved.resolvedFileName);
  if (resolved.isExternalLibraryImport || isNodeModulesFile(realPath)) {
    return resolved.extension === ts.Extension.Dts
      ? `declaration:${realPath}`
      : `external:${realPath}`;
  }
  return `internal:${realPath}`;
};

const describeOxc = (resolution: ModuleResolution): string => {
  switch (resolution.kind) {
    case "internal":
      return `internal:${realpathSync(resolution.filePath)}`;
    case "external":
      return `external:${resolution.filePath ? realpathSync(resolution.filePath) : resolution.packageName}`;
    case "builtin":
      return `external:${resolution.specifier}`;
    case "unresolved":
      return "unresolved";
  }
};

const stripKind = (described: string): string => described.slice(described.indexOf(":") + 1);

const classify = (tsc: string, oxc: string): ResolverAgreement => {
  if (tsc === oxc)
    return tsc === "unresolved"
      ? "both-unresolved"
      : tsc.startsWith("internal:")
        ? "same-file"
        : "both-external";
  if (tsc.startsWith("declaration:")) return "tsc-declaration-only";
  if (tsc === "unresolved") return "tsc-unresolved-only";
  if (oxc === "unresolved") return "oxc-unresolved-only";
  if (tsc.startsWith("external:") && oxc.startsWith("external:")) return "both-external";
  return stripKind(tsc) === stripKind(oxc) ? "same-file-different-kind" : "different-file";
};

const compareEntry = (entryId: string): ResolverComparison => {
  const [target] = loadCorpusTargets(corpusDirectory, [entryId]);
  const config = loadTsconfig(target.tsconfigPath);
  const specifiers = collectSpecifiers(config.fileNames);
  const cache = ts.createModuleResolutionCache(
    process.cwd(),
    (fileName) => fileName,
    config.options,
  );
  const tsc = timeSync(() =>
    specifiers.map(({ from, specifier }) =>
      describeTsc(
        ts.resolveModuleName(specifier, from, config.options, ts.sys, cache).resolvedModule,
      ),
    ),
  );
  const resolver = new ModuleResolver({
    tsconfigPath: target.tsconfigPath,
    rootDirectory: target.rootDirectory,
  });
  const oxc = timeSync(() =>
    specifiers.map(({ from, specifier }) => describeOxc(resolver.resolve(specifier, from))),
  );
  const agreement: Record<ResolverAgreement, number> = {
    "same-file": 0,
    "both-external": 0,
    "both-unresolved": 0,
    "tsc-declaration-only": 0,
    "tsc-unresolved-only": 0,
    "oxc-unresolved-only": 0,
    "same-file-different-kind": 0,
    "different-file": 0,
  };
  const disagreements: ResolverDisagreement[] = [];
  const examplesPerKind = new Map<ResolverAgreement, number>();
  specifiers.forEach(({ from, specifier }, index) => {
    const kind = classify(tsc.result[index], oxc.result[index]);
    agreement[kind] += 1;
    if (!EXAMPLE_KINDS.has(kind)) return;
    const shown = examplesPerKind.get(kind) ?? 0;
    if (shown >= EXAMPLES_PER_KIND) return;
    examplesPerKind.set(kind, shown + 1);
    disagreements.push({
      kind,
      from: path.relative(corpusDirectory, from),
      specifier,
      tsc: tsc.result[index],
      oxc: oxc.result[index],
    });
  });
  return {
    entryId,
    sourceFiles: config.fileNames.length,
    specifiers: specifiers.length,
    tscMs: tsc.elapsedMs,
    oxcMs: oxc.elapsedMs,
    agreement,
    disagreements,
  };
};

const ids =
  positionals.length > 0 ? positionals : ["sonner", "react-router-templates", "sentry", "posthog"];
console.log(
  "| entry | tsconfig files | specifiers | ts.resolveModuleName | oxc-resolver | same file | both external | both unresolved | tsc .d.ts only | tsc unresolved only | oxc unresolved only | same file, different kind | different file |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const id of ids) {
  const comparison = compareEntry(id);
  const agreement = comparison.agreement;
  console.log(
    `| ${id} | ${comparison.sourceFiles} | ${comparison.specifiers} | ${formatMs(comparison.tscMs)} | ${formatMs(comparison.oxcMs)} | ${agreement["same-file"]} | ${agreement["both-external"]} | ${agreement["both-unresolved"]} | ${agreement["tsc-declaration-only"]} | ${agreement["tsc-unresolved-only"]} | ${agreement["oxc-unresolved-only"]} | ${agreement["same-file-different-kind"]} | ${agreement["different-file"]} |`,
  );
  for (const disagreement of comparison.disagreements) {
    console.log(
      `    [${disagreement.kind}] ${disagreement.from}: "${disagreement.specifier}" tsc=${disagreement.tsc} oxc=${disagreement.oxc}`,
    );
  }
}
