import { it } from "vite-plus/test";
import { checkGuardedCases, createSeededRandom } from "./helpers/differential-evaluator.js";
import { checkSsaAgainstNative } from "./helpers/ssa-evaluator.js";

const createProgram = (seed: number): string => {
  const getRandom = createSeededRandom(seed);
  const fragments = Array.from({ length: 6 }, (_, stage) => {
    const amount = getRandom(9) + 1;
    const count = getRandom(5);
    switch (getRandom(9)) {
      case 0:
        return `if (gate) { left += ${amount}; right ^= left; } else { right -= ${amount}; left ^= right; }`;
      case 1:
        return `{ const previous = left; left = right; right = total; total = previous; }`;
      case 2:
        return `for(let iteration${stage}=0;iteration${stage}<${count};iteration${stage}++) { if(second && iteration${stage}===1) continue; total += left; left = right; right += ${amount}; }`;
      case 3:
        return `switch((total & 3)) { case 0: left += ${amount}; case 1: right -= left; break; default: total += right; case 2: left ^= total; }`;
      case 4:
        return `gate && (total += ${amount}); gate ||= second; gate &&= !first;`;
      case 5:
        return `{ let left = ${amount}; if (second) left += right; total += left; }`;
      case 6:
        return `try { if(gate) throw ${amount}; right += left; } catch(caught) { total += caught; } finally { left += ${count}; }`;
      case 7:
        return `label${stage}: { if(first) break label${stage}; left += ${amount}; if(second) break label${stage}; total ^= left; }`;
      default:
        return `gate = !gate; total = gate ? left + ${amount} : right - ${amount};`;
    }
  });
  return `let left=${getRandom(9)}; let right=${getRandom(9)}; let total=0; let gate=first; ${fragments.join("\n")} return left+':'+right+':'+total+':'+gate;`;
};

const generated = Array.from({ length: 256 }, (_, index) => ({
  seed: index + 1,
  body: createProgram(index + 1),
}));

it.each(generated)("matches native mixed structured control flow, seed $seed", ({ body }) => {
  for (const first of [false, true])
    for (const second of [false, true]) checkSsaAgainstNative(body, { first, second });
});

it.each(generated)("retains correlations across mixed control flow, seed $seed", ({ seed, body }) =>
  checkGuardedCases([{ name: `SSA seed ${seed}`, body: `return (() => { ${body} })();` }]),
);

const counts = [0, 1, 2, 3, 7, 31, 127, 255];
it.each(counts.flatMap((count) => ["for", "while", "do"].map((kind) => ({ count, kind }))))(
  "selects simultaneous loop phis: $kind/$count",
  ({ count, kind }) => {
    const step = "const previous=left; left=right; right=third; third=previous; index++;";
    const loop =
      kind === "for"
        ? `for(;index<${count};){${step}}`
        : kind === "while"
          ? `while(index<${count}){${step}}`
          : `do{${step}}while(index<${count});`;
    const body = `let left=1;let right=2;let third=3;let index=0;${loop}return left+':'+right+':'+third+':'+index;`;
    checkSsaAgainstNative(body);
    checkSsaAgainstNative(body, {}, true);
  },
);

it.each([0, 1, 2, 3].flatMap((key) => [0, 1, 2, 3].map((defaultIndex) => ({ key, defaultIndex }))))(
  "preserves switch test order, key=$key/default=$defaultIndex",
  ({ key, defaultIndex }) => {
    const clauses = [0, 1, 2].map(
      (value) => `case (trace+='${value}', ${value}): trace+='b${value}'; if(first) break;`,
    );
    clauses.splice(defaultIndex, 0, "default: trace+='d'; if(second) break;");
    const body = `let trace=''; switch(${key}) { ${clauses.join(" ")} } return trace;`;
    for (const first of [false, true])
      for (const second of [false, true]) checkSsaAgainstNative(body, { first, second });
  },
);
