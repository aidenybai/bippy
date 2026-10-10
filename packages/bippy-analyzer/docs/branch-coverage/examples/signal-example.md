# Example output signal

Real output from the coverage module (`tests/branch-coverage`), captured through the product
path: the source below was bundled with esbuild, run once under V8 coverage
exercising only the paths the driver hits, then analyzed. Every signal is on by
default (depth, interactions, infeasible-prune, edge cases, mutations).

## The code under test

```ts
export function classify(user, count, items) {
  if (user.role === "admin") {
    if (count > 100) {
      return escalate(count);
    }
    return "admin";
  }
  const tier = items.length >= 10 ? "bulk" : "single";
  if (count > 0 && user.active) {
    return tier;
  }
  return "idle";
}
function escalate(n) {
  return n > 1000 ? "huge" : "big";
}
// Driver exercises only: admin with a small count, and a non-admin active user.
classify({ role: "admin", active: true }, 5, []);
classify({ role: "user", active: true }, 3, [1, 2, 3]);
```

## The report

The per-file table leads with a Signals column (deepest guard + branch-gap / edge
/ mutant counts), then the ranked "Next tests to write" queue, then the detail
sections.

```text
┌───────────┬────────┬─────────┬───────┬──────────────┬──────────────────────┐
│ File      │ Lines% │ Branch% │ Func% │ Signals      │ Uncovered lines      │
├───────────┼────────┼─────────┼───────┼──────────────┼──────────────────────┤
│ app.ts    │     75 │   66.67 │    50 │ d2 6b 6e 10m │ 4-5,12,14            │
├───────────┼────────┼─────────┼───────┼──────────────┼──────────────────────┤
│ All files │     75 │   66.67 │    50 │ max depth 2  │ 12/16 lines, 1 files │
└───────────┴────────┴─────────┴───────┴──────────────┴──────────────────────┘

Next tests to write  (ranked across all signals: 12 of 12)
┌────┬──────────┬────────┬──────────────────────────────────────────────────────┐
│  # │ Location │ Kind   │ Do this                                              │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  1 │ app.ts:4 │ depth  │ add a spec that reaches this depth-2 block           │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  2 │ app.ts:9 │ mutant │ add an assertion that fails when `&&` becomes `||`   │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  3 │ app.ts:9 │ mutant │ add an assertion that fails when `>` becomes `>=`    │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  4 │ app.ts:3 │ branch │ drive `count > 100` to true                          │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  5 │ app.ts:8 │ branch │ drive `items.length >= 10` to true                   │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  6 │ app.ts:9 │ branch │ drive `count > 0 && user.active` to false            │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  7 │ app.ts:3 │ edge   │ vary `count` around the boundary 100 (>)             │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  8 │ app.ts:8 │ edge   │ vary `items.length` around the boundary 10 (>=)      │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│  9 │ app.ts:9 │ edge   │ vary `count` around the boundary 0 (>)               │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│ 10 │ app.ts:3 │ mutant │ cover both arms, then assert against `>` → `>=`      │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│ 11 │ app.ts:8 │ mutant │ cover both arms, then assert against `>=` → `>`      │
├────┼──────────┼────────┼──────────────────────────────────────────────────────┤
│ 12 │ app.ts:2 │ mutant │ add an assertion that fails when `===` becomes `!==` │
└────┴──────────┴────────┴──────────────────────────────────────────────────────┘

Control-flow depth  (depth-weighted branch coverage: 60%)
┌─────────────┬───────────┬─────────┬───────┬─────────────┬────────────────────┐
│ Script      │ Weighted% │ Branch% │ Depth │ Deep blocks │ Deepest gap        │
├─────────────┼───────────┼─────────┼───────┼─────────────┼────────────────────┤
│ app.mjs     │        60 │   58.33 │   2/2 │         5/7 │ app.ts:4 (depth 2) │
├─────────────┼───────────┼─────────┼───────┼─────────────┼────────────────────┤
│ All scripts │        60 │   58.33 │   2/2 │         5/7 │                    │
└─────────────┴───────────┴─────────┴───────┴─────────────┴────────────────────┘

Half-covered branches  (reached, but one arm never taken: 3 shown)
┌──────────┬──────────────────────────┬─────────┐
│ Location │ Condition                │ Never = │
├──────────┼──────────────────────────┼─────────┤
│ app.ts:3 │ count > 100              │ true    │
├──────────┼──────────────────────────┼─────────┤
│ app.ts:8 │ items.length >= 10       │ true    │
├──────────┼──────────────────────────┼─────────┤
│ app.ts:9 │ count > 0 && user.active │ false   │
└──────────┴──────────────────────────┴─────────┘

Edge cases  (boundary + null/undefined inputs the conditions imply: 3 shown)
┌──────────┬────────────────────┬─────────────────────────────────────────────────┐
│ Location │ Condition          │ Try                                             │
├──────────┼────────────────────┼─────────────────────────────────────────────────┤
│ app.ts:3 │ count > 100        │ vary `count` around the boundary 100 (>)        │
├──────────┼────────────────────┼─────────────────────────────────────────────────┤
│ app.ts:8 │ items.length >= 10 │ vary `items.length` around the boundary 10 (>=) │
├──────────┼────────────────────┼─────────────────────────────────────────────────┤
│ app.ts:9 │ count > 0          │ vary `count` around the boundary 0 (>)          │
└──────────┴────────────────────┴─────────────────────────────────────────────────┘

Mutation manifest  (operator mutants a faithful test should kill: 5 shown)
┌──────────┬───────────────────────┬───────────┬─────────┐
│ Location │ Condition             │ Mutate    │ Covered │
├──────────┼───────────────────────┼───────────┼─────────┤
│ app.ts:3 │ count > 100           │ > → >=    │ ~one    │
├──────────┼───────────────────────┼───────────┼─────────┤
│ app.ts:8 │ items.length >= 10    │ >= → >    │ ~one    │
├──────────┼───────────────────────┼───────────┼─────────┤
│ app.ts:9 │ count > 0             │ && → ||   │ both    │
├──────────┼───────────────────────┼───────────┼─────────┤
│ app.ts:9 │ count > 0             │ > → >=    │ both    │
├──────────┼───────────────────────┼───────────┼─────────┤
│ app.ts:2 │ user.role === "admin" │ === → !== │ both    │
└──────────┴───────────────────────┴───────────┴─────────┘
```

See `signal-example.json` for the full machine-readable summary (including the
`worklist` array an agent consumes).
