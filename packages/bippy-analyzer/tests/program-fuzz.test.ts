import { describe, expect, it } from "vite-plus/test";
import { sample } from "fast-check";
import { decodePrimitive, encodePrimitive } from "./helpers/differential-evaluator.js";
import {
  FUZZ_INPUTS,
  createFuzzProgram,
  evaluateFuzzCase,
  getFuzzCaseArbitrary,
  getFuzzRepro,
  getGeneratedCaseArbitrary,
  getReproFileName,
  isUncertainSignature,
  loadFuzzRepros,
  persistFuzzRepro,
  renderFuzzNode,
  replayFuzzFailure,
  replayFuzzRepro,
  runFuzzCampaign,
  type FuzzCampaign,
  type GeneratedFuzzProgram,
} from "./helpers/program-fuzzer.js";

const GRAMMARS: GeneratedFuzzProgram["grammar"][] = ["scalar", "heap"];
const SMOKE_SEED = 1;
const SMOKE_RUNS = 144;
const SMOKE_UNCERTAINTY: Record<GeneratedFuzzProgram["grammar"], Record<string, number>> = {
  scalar: { "ssa:dynamic number": 16, "ssa:dynamic string": 1, "ssa:imprecise": 13 },
  heap: {
    "ast:dynamic number": 50,
    "ast:dynamic string": 9,
    "ast:imprecise": 2,
    "ast:optional": 23,
    "ast:unknown(loop-carried value)": 1,
  },
};
const HEAP_CONSTRUCTS = [
  /`t\$\{/,
  / in box\)/,
  /for \(const index\d+ in box\)/,
  /maybe\?\.add\(/,
  /\?\.\(/,
  /list\.push\(/,
  /listAlias\.pop\(\)|list\.shift\(\)/,
  /(box|list|listAlias)\[/,
  /\(alpha, beta = alpha\) =>/,
  /setBeta\(/,
  /maybe\?\.count/,
  /[^.]primitive[^ =]/,
  /(String|Number)\(/,
];
const knownRepros = loadFuzzRepros();
const campaignRuns = Number(process.env.BIPPY_FUZZ_RUNS ?? 0);
const campaignSeed = Number(process.env.BIPPY_FUZZ_SEED ?? Date.now());
const smokeCampaigns = new Map<GeneratedFuzzProgram["grammar"], Promise<FuzzCampaign>>();

const getKnownSignatures = (grammar: GeneratedFuzzProgram["grammar"]) =>
  new Set(
    knownRepros.filter((repro) => repro.grammar === grammar).map(({ signature }) => signature),
  );

const getSmokeCampaign = (grammar: GeneratedFuzzProgram["grammar"]): Promise<FuzzCampaign> => {
  const existing = smokeCampaigns.get(grammar);
  if (existing) return existing;
  const campaign = runFuzzCampaign(getGeneratedCaseArbitrary(grammar), {
    seed: SMOKE_SEED,
    numRuns: SMOKE_RUNS,
    known: getKnownSignatures(grammar),
  });
  smokeCampaigns.set(grammar, campaign);
  return campaign;
};

const getUncertaintyClass = (signature: string): string => {
  const [modeText, , kind, ...rest] = signature.split(":");
  const mode = modeText.split("[")[0];
  if (kind !== "unresolved") return `${mode}:${kind}`;
  const text = rest.join(":");
  const dynamicType = text.match(/^<(\w+):/)?.[1];
  if (dynamicType) return `${mode}:dynamic ${dynamicType}`;
  return `${mode}:${text.startsWith("unknown(") ? text : text.split("(")[0]}`;
};

const getUncertaintyCounts = ({ observed }: FuzzCampaign) => {
  const counts: Record<string, number> = {};
  for (const [signature, count] of observed) {
    if (!isUncertainSignature(signature)) continue;
    const uncertaintyClass = getUncertaintyClass(signature);
    counts[uncertaintyClass] = (counts[uncertaintyClass] ?? 0) + count;
  }
  return counts;
};

const getSignatures = ({ failures }: FuzzCampaign) =>
  failures.map((failure) => failure.result.signature);

describe("differential fuzzing with fast-check", () => {
  it("encodes primitive outcomes losslessly", () => {
    const encoded = FUZZ_INPUTS.map(encodePrimitive);
    expect(new Set(encoded).size).toBe(FUZZ_INPUTS.length);
    for (const [index, text] of encoded.entries())
      expect(Object.is(decodePrimitive(text), FUZZ_INPUTS[index]), text).toBe(true);
  });

  it("generates the same cases for the same seed", () => {
    for (const grammar of GRAMMARS) {
      const render = () =>
        sample(getGeneratedCaseArbitrary(grammar), { seed: 7, numRuns: 3 }).map(
          ({ program, input }) => `${encodePrimitive(input)}\n${renderFuzzNode(program.root)}`,
        );
      expect(render()).toEqual(render());
    }
  });

  it("exercises every heap construct over smoke cases", () => {
    const bodies = sample(getGeneratedCaseArbitrary("heap"), {
      seed: SMOKE_SEED,
      numRuns: SMOKE_RUNS,
    }).map(({ program }) => renderFuzzNode(program.root).split("try { completion")[1]);
    for (const construct of HEAP_CONSTRUCTS)
      expect(
        bodies.some((body) => construct.test(body)),
        String(construct),
      ).toBe(true);
  });

  it.each(GRAMMARS)(
    "matches native outcomes except recorded fuzz defects over smoke cases: %s",
    { timeout: 300_000 },
    async (grammar) => {
      expect(getSignatures(await getSmokeCampaign(grammar))).toEqual([]);
    },
  );

  it.each(GRAMMARS)(
    "known precision gap: smoke case uncertainty stays as recorded: %s",
    { timeout: 300_000 },
    async (grammar) => {
      expect(getUncertaintyCounts(await getSmokeCampaign(grammar))).toEqual(
        SMOKE_UNCERTAINTY[grammar],
      );
    },
  );

  it("stays in SSA past an operation that throws on every path", async () => {
    const result = await evaluateFuzzCase({
      program: {
        grammar: "scalar",
        root: {
          role: "fixed",
          parts: [
            `let trace = "" + second; trace *= 1n; switch (0) { case 0: trace += 0; } return trace;`,
          ],
        },
      },
      input: undefined,
    });
    expect(result?.execution?.mode).toBe("ssa");
    expect(result?.signature).toBeNull();
  });

  it("admits a read past the end of a list through an unknown number index", async () => {
    const result = await evaluateFuzzCase({
      program: {
        grammar: "heap",
        root: {
          role: "fixed",
          parts: [`const list = [1, 2]; return list[second * -1] ? "hit" : "miss";`],
        },
      },
      input: undefined,
    });
    expect(isUncertainSignature(result?.signature ?? null)).toBe(true);
  });

  it("reads a thrown instance of a built-in error subclass as unresolved, not a plain object", async () => {
    const result = await evaluateFuzzCase({
      program: {
        grammar: "heap",
        root: {
          role: "fixed",
          parts: [`class PathError extends TypeError {} throw new PathError("x");`],
        },
      },
      input: undefined,
    });
    expect(result?.signature).toBe(
      "ast[static create-class]:uncertain:unresolved:unknown(members inherited from global TypeError)",
    );
  });

  it("leaves a loop that forks on every iteration uncertain instead of overflowing the stack", async () => {
    const result = await evaluateFuzzCase({
      program: {
        grammar: "heap",
        root: {
          role: "fixed",
          parts: [
            `const text = String(Math.random()); let index = 0; let path = ""; while (index < 200) { if (text[index++] === "}") throw new Error("x"); path += "a"; } return path;`,
          ],
        },
      },
      input: undefined,
    });
    expect(result?.signature).toMatch(/:uncertain:unresolved:<string: loop-carried value>$/);
  });

  it("runs each native assignment in a fresh global scope", async () => {
    const result = await evaluateFuzzCase({
      program: {
        grammar: "heap",
        root: {
          role: "fixed",
          parts: [`globalThis.runs = (globalThis.runs ?? 0) + 1; return globalThis.runs;`],
        },
      },
      input: undefined,
    });
    expect(result?.signature ?? null).not.toMatch(/mismatch/);
  });

  it(
    "shrinks a silent SSA fallback to its cause, keeping the mode, and replays it by path",
    { timeout: 120_000 },
    async () => {
      const arbitrary = getFuzzCaseArbitrary((getRandom) => {
        const program = createFuzzProgram(getRandom, "scalar");
        const [declarations, setup, ...statements] = program.root.parts;
        return {
          ...program,
          root: {
            ...program.root,
            parts: [
              declarations,
              setup,
              { role: "statement", parts: ['trace += ("a" in value);'] },
              ...statements,
            ],
          },
        };
      });
      const [original] = sample(arbitrary, { seed: 3, numRuns: 1 });
      const { failures } = await runFuzzCampaign(arbitrary, { seed: 3, numRuns: 1 });
      expect(failures.map((failure) => failure.result.signature)).toEqual([
        "fallback:static:in operator",
      ]);
      const repro = getFuzzRepro(failures[0]);
      expect(repro.mode).toBe("ast");
      expect(repro.input).toBe("undefined");
      expect(repro.source).toContain('("a" in value)');
      expect(repro.source.length).toBeLessThan(renderFuzzNode(original.program.root).length / 2);
      expect((await replayFuzzRepro(repro))?.signature).toBe(repro.signature);
      const replayed = await replayFuzzFailure(arbitrary, failures[0]);
      expect(replayed && renderFuzzNode(replayed.program.root)).toBe(repro.source);
    },
  );
});

describe.runIf(knownRepros.length > 0)("persisted fuzz repros", () => {
  it.each(
    knownRepros.map((repro) => ({
      label: repro.signature.startsWith("fallback:")
        ? "known limitation: SSA fallback"
        : "known defect",
      name: getReproFileName(repro),
      repro,
    })),
  )("$label: $name ($repro.rootCause)", async ({ repro }) => {
    expect(repro.rootCause, "persisted repros need a triaged root cause").toBeTruthy();
    const result = await replayFuzzRepro(repro);
    expect(result?.signature).toBe(repro.signature);
    expect(result?.assignments).toEqual(repro.assignments);
  });
});

describe.runIf(campaignRuns > 0)("opt-in fuzz campaign", () => {
  it.each(GRAMMARS)("%s", { timeout: 0 }, async (grammar) => {
    const campaign = await runFuzzCampaign(getGeneratedCaseArbitrary(grammar), {
      seed: campaignSeed,
      numRuns: campaignRuns,
      known: getKnownSignatures(grammar),
    });
    for (const failure of campaign.failures) {
      const repro = getFuzzRepro(failure);
      const location = process.env.BIPPY_FUZZ_OUTPUT
        ? persistFuzzRepro(repro, process.env.BIPPY_FUZZ_OUTPUT)
        : `seed ${repro.seed} path ${repro.path}`;
      process.stdout.write(`${repro.signature}\n  ${location}\n`);
    }
    process.stdout.write(
      `${grammar}: seed ${campaignSeed}, ${campaignRuns} cases, uncertainty ${JSON.stringify(getUncertaintyCounts(campaign))}\n`,
    );
    expect(getSignatures(campaign)).toEqual([]);
  });
});
