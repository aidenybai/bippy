import { describe, expect, it } from "vite-plus/test";
import { sample } from "fast-check";
import { extractCorpusFunctions, extractRepositoryFunctions } from "./helpers/corpus-extraction.js";
import {
  createSourceTree,
  getCorpusCaseArbitrary,
  getCorpusProgramSource,
} from "./helpers/corpus-fuzzer.js";
import { getCorpusRepositories } from "./helpers/corpus-repositories.js";
import {
  getFuzzReductions,
  getFuzzRepro,
  isUncertainSignature,
  loadFuzzRepros,
  persistFuzzRepro,
  renderFuzzNode,
  runFuzzCampaign,
} from "./helpers/program-fuzzer.js";

const SAMPLE_FILES = [
  {
    path: "src/strings.ts",
    code: `import { clamp } from "./numbers";
import { repeat as repeatText } from "./index.js";
import type { Options } from "./types";
export interface Shape { size: number }
const SEPARATOR = "-";
export function kebab(text: string, options?: Options): string {
  return text.trim().toLowerCase().split(/\\s+/).join(SEPARATOR);
}
export const pad = (text: string, size: number, fill = " "): string =>
  repeatText(fill, clamp(size - text.length, 0, 10)) + text;
export const getStored = (text) => localStorage.getItem(text);
export const patchArrays = () => {
  Array.prototype.last = function () { return this[this.length - 1]; };
};
export class Token {
  constructor(public readonly text: string, private options?: Options) {}
  describe(): string { return this.text + (this.options ? "!" : ""); }
}
export function tokenize(text: string): string {
  return new Token(text).describe() as string;
}
export default (mode: "upper" | "lower", ...parts: string[]) =>
  mode === "upper" ? parts.join("").toUpperCase() : parts.join("");
`,
  },
  {
    path: "src/numbers.ts",
    code: `export const clamp = (value: number, lower: number, upper: number) =>
  Math.min(Math.max(value, lower), upper);
export const roll = () => Math.random();
`,
  },
  {
    path: "src/index.ts",
    code: `export * from "./numbers";\nexport { repeat } from "./repeat";\n`,
  },
  {
    path: "src/repeat.js",
    code: `/**
 * @param {string} text
 * @param {number} times
 */
export function repeat(text, times) {
  let result = "";
  for (let index = 0; index < times; index++) result += text;
  return result;
}
`,
  },
];
const extracted = extractCorpusFunctions(SAMPLE_FILES, "sample");
const getSampleFunction = (name: string) => {
  const found = extracted.functions.find((candidate) => candidate.origin.endsWith(`#${name}`));
  if (!found) throw new Error(`Missing sample function ${name}`);
  return found;
};
const runNative = (source: string): unknown =>
  new Function("first", "second", "value", `"use strict";\n${source}`)(true, false, 0);

const corpusDirectory = process.env.BIPPY_CORPUS_DIR;
const campaignRuns = Number(process.env.BIPPY_FUZZ_RUNS ?? 0);
const campaignSeed = Number(process.env.BIPPY_FUZZ_SEED ?? Date.now());
const repositoryLimit = Number(process.env.BIPPY_CORPUS_LIMIT ?? Infinity);

describe("real-code corpus extraction", () => {
  it("closes functions over local, imported and re-exported declarations only", () => {
    expect(extracted.functions.map(({ origin }) => origin).sort()).toEqual([
      "sample:src/numbers.ts#clamp",
      "sample:src/repeat.js#repeat",
      "sample:src/strings.ts#defaultExport",
      "sample:src/strings.ts#kebab",
      "sample:src/strings.ts#pad",
      "sample:src/strings.ts#tokenize",
    ]);
    expect(extracted.rejections).toEqual({
      "builtin mutation": 1,
      "global localStorage": 1,
      "Math.random": 1,
    });
  });

  it("emits dependencies before their importers and strips types", () => {
    const { source } = getSampleFunction("pad");
    expect(source.indexOf("function repeat")).toBeLessThan(source.indexOf("const pad"));
    expect(source.indexOf("const clamp")).toBeLessThan(source.indexOf("const pad"));
    expect(source).not.toMatch(/: (string|number)/);
    expect(source).not.toContain("Options");
    expect(runNative(getCorpusProgramSource(getSampleFunction("pad"), ['"ab"', "5"]))).toEqual([
      "array",
      2,
      "   ab",
      ["array", 2, "ab", 5],
    ]);
  });

  it("derives argument kinds from types, JSDoc, defaults and names", () => {
    expect(getSampleFunction("kebab").parameters.map(({ kind }) => kind)).toEqual([
      "string",
      "object",
    ]);
    expect(getSampleFunction("repeat").parameters.map(({ kind }) => kind)).toEqual([
      "string",
      "number",
    ]);
    expect(getSampleFunction("pad").parameters.map(({ kind }) => kind)).toEqual([
      "string",
      "number",
      "string",
    ]);
    expect(getSampleFunction("defaultExport").parameters).toEqual([
      { kind: "any", literals: ['"upper"', '"lower"'], isRest: false },
      { kind: "string", literals: [], isRest: true },
    ]);
  });

  it("builds deterministic programs whose trees render back to the source", () => {
    const render = () =>
      sample(getCorpusCaseArbitrary(extracted.functions), { seed: 4, numRuns: 4 }).map(
        ({ program }) => renderFuzzNode(program.root),
      );
    expect(render()).toEqual(render());
    const source = getCorpusProgramSource(getSampleFunction("pad"), ['"ab"', "5"]);
    const tree = createSourceTree(source);
    expect(renderFuzzNode(tree).replace(/\s+/g, "")).toBe(source.replace(/\s+/g, ""));
    expect(runNative(renderFuzzNode(tree))).toEqual(runNative(source));
    expect(getFuzzReductions(tree).length).toBeGreaterThan(50);
  });

  it("matches native outcomes over sample functions", { timeout: 120_000 }, async () => {
    const { failures } = await runFuzzCampaign(getCorpusCaseArbitrary(extracted.functions), {
      seed: 1,
      numRuns: extracted.functions.length * 8,
    });
    expect(failures.map((failure) => [failure.program.origin, failure.result.signature])).toEqual(
      [],
    );
  });
});

describe.runIf(corpusDirectory)("opt-in real-code corpus campaign", () => {
  it(
    "matches native outcomes over functions extracted from GitHub repositories",
    { timeout: 0 },
    async () => {
      if (!corpusDirectory) return;
      const functions = getCorpusRepositories()
        .slice(0, repositoryLimit)
        .flatMap((repository) => {
          const extraction = extractRepositoryFunctions(corpusDirectory, repository);
          const rejections = Object.entries(extraction?.rejections ?? {})
            .sort(([, left], [, right]) => right - left)
            .slice(0, 4)
            .map(([reason, count]) => `${reason} ${count}`)
            .join(", ");
          process.stdout.write(
            extraction
              ? `${repository.repository}: ${extraction.files} files, ${extraction.targets} targets, ${extraction.functions.length} closed (${rejections})\n`
              : `${repository.repository}: checkout failed\n`,
          );
          return extraction?.functions ?? [];
        });
      const numRuns = campaignRuns || functions.length;
      const campaign = await runFuzzCampaign(getCorpusCaseArbitrary(functions), {
        seed: campaignSeed,
        numRuns,
        known: new Set(
          loadFuzzRepros()
            .filter((repro) => repro.grammar === "corpus")
            .map(({ signature }) => signature),
        ),
      });
      for (const failure of campaign.failures) {
        const repro = getFuzzRepro(failure);
        const location = process.env.BIPPY_FUZZ_OUTPUT
          ? persistFuzzRepro(repro, process.env.BIPPY_FUZZ_OUTPUT)
          : `seed ${repro.seed} path ${repro.path}`;
        process.stdout.write(`${repro.signature}\n  ${repro.origin}\n  ${location}\n`);
      }
      const uncertain = [...campaign.observed]
        .filter(([signature]) => isUncertainSignature(signature))
        .reduce((total, [, count]) => total + count, 0);
      process.stdout.write(
        `corpus: ${functions.length} functions, seed ${campaignSeed}, ${numRuns} cases, ${uncertain} uncertain\n`,
      );
      expect(campaign.failures.map((failure) => failure.result.signature)).toEqual([]);
    },
  );
});
