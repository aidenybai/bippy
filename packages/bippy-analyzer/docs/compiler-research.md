# Compiler research

## The failure

Consider a getter used in a condition:

```ts
let reads = 0;
const value = first
  ? {
      get kind() {
        reads++;
        return "leaf";
      },
      text: "a",
    }
  : {
      get kind() {
        reads++;
        return "node";
      },
      text: "b",
    };
if (value.kind === "leaf") return reads + ":" + value.text;
return reads + ":" + value.text;
```

Native JavaScript reads `value.kind` once. Bippy's speculative narrowing could read it three times: once to execute the condition, then again while testing candidate values. The new differential tests reproduced `3:b` where native execution returned `1:b`.

The fix removes `narrowTestByEvaluation`, not just its handling of getters. Narrowing now inspects modeled values and syntax instead of replaying a condition. Predicate recognition also stops evaluating arbitrary member callees: looking up `helpers.check` a second time can itself call a getter.

## Sequential narrowing

For an explicitly unknown input, each test can supply a fact used by the next:

```ts
const getLabel = (value: unknown) => {
  if (typeof value === "string" && value === "ready") {
    return value.toUpperCase();
  }
  return "waiting";
};
```

On the true path, the left test establishes that `value` is a string. The right test then establishes that it is `"ready"`. The body can return `"READY"`, rather than unknown text.

TypeScript's `narrowTypeByBinaryExpression` applies the right refinement to the left refinement's result. Bippy previously intersected independently constructed values by object identity. Two separately allocated representations of a narrowed value need not have the same identity.

Type refinement must also preserve input identity. A fresh unknown-string value cannot become an independent input: `typeof value` and `value === "ready"` must constrain the same value. Refined scalar views now alias their source. The combined string example exposed this additional defect and is covered by a native-backed regression.

The adaptation in `src/evaluate/narrowing.ts` passes a refined lookup to the right test:

- For `A && B`, use the true side of `A` when refining `B`'s true side.
- For `A || B`, use the false side of `A` when refining `B`'s false side.
- Retain the original value on the other side, rather than introducing a new union algorithm.

The extra compound refinement is restricted to read-only syntax. A callback can overwrite the tested binding; facts about its old value must not restore that value after the callback. Calls, property access, assignments, updates, and coercive comparisons therefore block this compound refinement. Normal short-circuit evaluation still runs, with its existing guards and mutation handling.

Strict literal comparisons also narrow identifier values. For example, the true side of `value === "ready"` can substitute the literal. For a modeled unknown Boolean, the false side of `value === true` can substitute `false`.

This is deliberately narrower than TypeScript's rule. `value == 1` can accept `"1"`; substituting the number would change runtime behavior. Likewise, `value === 0` accepts both `0` and `-0`. Bippy leaves uncertain numeric zero unresolved instead of inventing positive zero. Source annotations are not runtime evidence.

## Boolean identity

A separate regression concerned the relationship between a Boolean input and its comparison:

```ts
const label = first === false ? "pass" : "fail";
return label + ":" + String(first);
```

With `first` explicitly modeled as an unknown Boolean, selecting `first = false` from the combined result admitted `"fail:false"`. Native execution returns only `"pass:false"`. Checking the unassigned set of possible labels would miss this mistake.

TypeScript's Boolean-comparison narrowing reduces a literal comparison to the corresponding truth condition. The adaptation in `src/evaluate/operators.ts` records that relationship directly:

```text
Boolean first === true  → first's existing condition
Boolean first === false → the negation of that condition
```

The same rule handles inequality, reversed operands, and loose equality when both operands are already known to be Boolean. It does not turn arbitrary `value === true` into a truthiness check: `1` is truthy but is not `true`.

All 16 combinations of operator, Boolean literal, and operand order failed the assignment-sensitive tests before this normalization and pass afterward.

## React and Oxc

React Compiler tracks each assignment to `label` separately. In simplified notation:

```text
label₀ = "Login"
if flag:
  label₁ = "Dashboard"
label₂ = phi(true predecessor: label₁, false predecessor: label₀)
```

This is single static assignment (SSA). The phi selects the definition from the predecessor used to reach the join.

`EnterSSA` tracks definitions by block and original identifier. When not all predecessors are available, it creates an incomplete phi and completes it when the block can be sealed. `EliminateRedundantPhi` removes a phi whose non-self operands all name the same value. Repeated passes handle dependencies across back edges.

Oxc's Rust passes implement the same construction and simplification over its HIR. These are not independent runtime models that can validate Bippy by agreeing with one another. Their shared algorithm is useful for tracking which assignment a read refers to, not for supplying JavaScript or React execution semantics.

Bippy already joins execution paths as guarded values. Replacing that with bare phi operands would lose the input-to-path association unless the CFG edges and their conditions were preserved too. Loop phis also describe recurrences; they do not enumerate loop outcomes or scheduled work. The initial narrowing patch did not add SSA. The subsequent implementation adds a CFG and SSA passes while retaining incoming-edge identity and the evaluator's guards.

React's and Oxc's type inference create constraints over HIR identifiers, unify them, and write resolved types back. The React implementation explicitly treats mutable captured-context reads differently from immutable local values. React's separate aliasing model distinguishes assigning a reference, capturing it in an object, extracting a possible alias, and mutating through those references.

Those distinctions matter to an evaluator, but copying the type unifier would not preserve a setter call, a closure's later read, or a queued React update. Its types and environment signatures serve compilation and memoization. This change does not replace Bippy's heap journals, captured scopes, task scheduler, or real React reconciler with compiler assumptions.

## SSA execution

```ts
const getValue = (flag: boolean) => {
  let value = 3;
  while (flag) {
    value = 4;
    break;
  }
  return value;
};
```

With an explicitly modeled unknown Boolean, one analysis must associate `false` with `3` and `true` with `4`. Before direct SSA execution, the guarded regression admitted the wrong result on the false path. Matching the unordered set `{3, 4}` would not catch that error.

A simplified view of the graph is:

```text
entry: value₀ = 3
       branch flag
true:  value₁ = 4; break
join:  value₂ = phi(true edge: value₁, false edge: value₀)
       return value₂
```

`src/compiler/` now contains lexical binding resolution, CFG lowering, sealed-block SSA construction, redundant-phi elimination, dominance verification, and sparse conditional constant propagation. Reassignments get distinct definitions. Loop headers can have incomplete phis until their back-edge definitions become available. Phi simplification also handles mutually recursive phi groups, using iterative traversal rather than the JavaScript call stack.

Edges retain truthy/falsy, nullish/defined, exceptional, and suspension distinctions. Constant propagation considers only executable incoming edges and distinguishes positive and negative zero. Captured bindings remain opaque cells; calls, property operations, and coercive operators carry a conservative effect-token dependency. This is not heap alias analysis.

`evaluate/ssa-execution.ts` executes eligible graphs during function calls. It chooses phi operands simultaneously from the actual incoming edge and uses the existing guard solver for unknown tests. It preserves pending exceptions across nested `finally` execution and checks uninitialized reads and immutable writes. The interpreter's step budget and loop-unrolling bound still apply.

### Why not substitute reads?

An early integration replaced AST identifier reads with compiler constants. For a `const` assignment that the AST evaluator incorrectly accepted, substitution changed the returned value without restoring the required `TypeError`. That was not a fix.

Read substitution was removed. Compiler constants are consumed only inside SSA execution. Unsupported functions use the existing AST evaluator for the whole body. A runtime deoptimization restores the attempt's step budget; the admitted operations cannot call application code or write application state before that fallback.

### Execution boundary

The construction passes operate on general CFGs, but the executable instruction set is narrower. Scalar parameters and operations, local reassignment, branches, loops, and tested exception paths can run through SSA. Reads of the modeled errors' `name` and `message` are also supported. Eligibility uses modeled values, not TypeScript annotations.

Mutable captures, arbitrary heap operations, calls, JSX construction, destructuring parameters, async functions, and generators still use the existing evaluator. The frontend represents many of these as opaque operations or suspension edges; that does not make them executable SSA implementations. In particular, precise iterator cleanup, per-iteration captured environments, and suspension histories need further lowering and runtime work. Dynamic scope and construction limits produce explicit unsupported compilation results; compiler invariant failures are not silently swallowed.

This is an integrated local-value SSA backend, not a complete replacement of JavaScript or React execution. Heap journals, captured scopes, task scheduling, and reconciliation remain necessary.

## Differential fuzzing

```js
while (true) {
  if (first) return "early";
  break;
}
return "end";
```

Native execution returns `"early"` when `first` is true and `"end"` otherwise. The AST evaluator returned only `"early"`: the loop recorded that some paths returned and the rest broke out, but leaving the loop never marked the breaking paths as completing. The fuzzer found this after an object operand deoptimized SSA to the AST path; the defect predates this change.

[fast-check](https://github.com/dubzzz/fast-check) 4.10.2 supplies seeded generation, shrinking, and replay. Bippy supplies only the bounded program generators and scope-preserving shrinkers in `tests/helpers/program-fuzzer.ts`. The `scalar` grammar must execute through SSA. The `heap` grammar adds:

- objects, and method calls with different receivers (`box.add` called through `other`);
- getters and setters;
- `valueOf`, `toString`, and `Symbol.toPrimitive` coercion, reached through operators, template literals, computed keys, `in`, `String()`, and `Number()`;
- optional members and calls (`maybe?.count`, `maybe?.add(1)`);
- `for…in` over objects, list `push`, `pop`, and `shift` through an alias;
- default parameters that read earlier parameters;
- captured closures and callbacks.

Both grammars combine assignments, aliases, shadowing, conditionals, short-circuit and logical assignments, loops, labeled blocks, switches, `try`/`catch`/`finally`, and abrupt completions. A smoke test checks that the 144 smoke cases reach every heap construct.

### Failure definition

A case fails when the same input produces a different value, exception, or observable trace, and the expected SSA or fallback mode remains intact.

Each program runs natively and once in the analyzer with every input unknown. The comparison selects each input assignment from that one combined analysis, as the existing differential helpers do, and compares:

- whether it returned or threw, and the value;
- the full trace of events, bindings, and receiver counts, not only the final value;
- primitives through a lossless encoding, so `NaN`, `-0`, BigInts, and `undefined` stay distinct.

A signature records the execution mode and the first difference: `ssa:mismatch:value:boolean≠boolean`, `ast[static captured binding]:mismatch:events:length`, `ssa:uncertain:imprecise`, or `fallback:static:in operator`. A mismatch outranks a fallback, and a fallback outranks uncertainty, so a scalar program that leaves SSA fails even when its result is also imprecise. Uncertain results pass: the analysis kept an alternative it could not rule out, which is imprecise but not wrong.

The fast-check property fails on the first signature that is neither uncertain nor already persisted. From then on, a shrink candidate counts as failing only if it reproduces that exact signature. Because the signature includes the mode and fallback reason, shrinking cannot trade an SSA mismatch for an AST one or a mismatch for a fallback. A campaign excludes each signature it finds and reruns `check` from the same seed until no new signature appears; evaluations are cached by source and input, so reruns are cheap.

### Scope-preserving shrinking

```js
let alpha = second;
alpha &&= first;
return String(alpha);
```

fast-check shrank a heap program to `trace &&= (alpha &&= flag)` after `let alpha = second`, and the regression above is that witness reduced by hand. With `second` true and `first` false, native execution returns `"false"`. The AST join treated the two unknown Booleans as interchangeable and kept one, so the result stopped depending on the input it did not replace.

`FuzzCaseArbitrary` is a custom `Arbitrary`. `generate` draws the program from Bippy's grammar with fast-check's random source. `shrink` yields simpler inputs first, then tree reductions: remove a statement or `switch` clause, unwrap a block, or replace an expression with a subexpression or `0`. A candidate is offered only when it has no more nodes than the original and references no name the original left unbound. Without that check, removing `let copy = …` turns a later `copy` into a `ReferenceError` that is a different program, not a smaller witness. The heap helpers (`box`, `coerce`, `primitive`, …) are a fixed prelude and never shrink.

Each generated program gets its own step budget of 1,000,000 steps; other differential tests keep 5,000,000. An exhausted budget returns an unknown value, which the fuzzer reports as uncertainty rather than a crash.

A failure records fast-check's seed and counterexample path, and `replayFuzzFailure` reproduces it with `check({ seed, path, numRuns: 1 })` while the generators are unchanged. Persisted repros under `tests/fuzz-repros/` also keep the shrunk source, input, per-assignment expected and actual outcomes, mode, fallback reason, and a triaged root cause, so they replay after the generators change.

fast-check's `scheduler` can order controlled promise resolutions, which could test async interleavings against the evaluator's microtask queue. It does not model React's scheduler or browser task ordering, so it is not used; async fuzzing would need its own grammar.

### Real-code corpus

```js
const corpusModule0 = (() => {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  return { clamp };
})();
const corpusTarget = corpusModule0.clamp;
const corpusArguments = [first ? 42 : NaN, 0, 255];
return describeCorpusValue([corpusTarget(...corpusArguments), corpusArguments], 0);
```

The closure is `clamp` from PostHog's `ZoomableImage.tsx`; the argument line is one draw from the number pool. `tests/helpers/corpus-extraction.ts` builds programs like this from pinned GitHub checkouts: 45 utility libraries (lodash, ramda, d3, date and color utilities, …) and the utility directories of the 499 applications in `corpus/manifest.json`. It parses each file with Babel, strips types with esbuild, and closes each exported or top-level function over the local, imported, and re-exported declarations it reaches. It rejects a function that reaches a package import or a global outside a safe list (`Math`, `JSON`, typed arrays, …), an import cycle, a program over 24,000 characters, or a duplicate.

Arguments come from pools chosen by the parameter's TypeScript type, JSDoc, default value, or name: `predicate` gets a function and `count` a number. A quarter are `(first ? a : b)`, so one analysis covers both. The program returns the arguments beside the result, so mutating an argument is part of the observable trace. `tests/helpers/corpus-fuzzer.ts` converts the program's Babel AST into the same shrink tree, so corpus failures shrink with the same scope check.

| Measure                  |  Value |
| ------------------------ | -----: |
| Repositories checked out |    543 |
| Source files read        | 21,387 |
| Functions found          | 39,749 |
| Closed functions         | 17,114 |

The leading rejections, as lower bounds because the log keeps each repository's top four, are a package import (13,382), `React` (1,281), `Date` (1,033), an unresolved import (680), `cy` (344), `URL` (330), an unparsed file (326), and `process` (294). Host globals such as `Date` stay out because native and analyzed runs would read different clocks.

### Commands

```sh
pnpm --filter bippy-analyzer test tests/program-fuzz.test.ts tests/corpus-fuzz.test.ts
BIPPY_FUZZ_RUNS=2000 BIPPY_FUZZ_SEED=20260923 BIPPY_FUZZ_OUTPUT=/tmp/fuzz-out \
  pnpm --filter bippy-analyzer test tests/program-fuzz.test.ts
BIPPY_CORPUS_DIR=/tmp/bippy-corpus BIPPY_FUZZ_SEED=20260923 BIPPY_FUZZ_OUTPUT=/tmp/corpus-out \
  pnpm --filter bippy-analyzer test tests/corpus-fuzz.test.ts
```

The first is the CI run: 144 cases per grammar from seed 1, no unrecorded failure, uncertainty counts pinned per class so precision changes are visible, and corpus extraction and fuzzing over sample files. The second is the generated campaign; `BIPPY_FUZZ_RUNS` sets the cases per grammar. The third clones the corpus into `BIPPY_CORPUS_DIR`, caches extractions beside the checkouts, and draws as many cases as there are closed functions unless `BIPPY_FUZZ_RUNS` says otherwise; `BIPPY_CORPUS_LIMIT` caps the repositories. Both campaigns shrink and write one repro per new signature to `BIPPY_FUZZ_OUTPUT`, and fail while any remain.

### Campaigns

Before fast-check, a hand-written seeded generator and greedy shrinker ran these campaigns. Their seeds do not replay under fast-check:

| Seeds                            | Programs | Time                 | New defects                                                                                                         |
| -------------------------------- | -------: | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1000–1599, both grammars         |    1,200 | ~35 min              | 7 mismatch repros after deduplication                                                                               |
| scalar 1000–3999                 |    3,000 | 76 s                 | 1 (scalar 2282)                                                                                                     |
| heap 1000–2499, extended grammar |    1,500 | 6–40 s per 100 seeds | heap 45, 1020, 1521, 2095, and 2308; later 2412, a regression in the heap-45 fix; seeds 1300–1399 ran out of memory |
| final: heap 1000–2499            |    1,500 | 265 s                | none                                                                                                                |
| final: scalar 1000–3999          |    3,000 | 67 s                 | none; 10 programs hit the known `scalar-110` deoptimization                                                         |

The memory failures came from path forking, which only the step budget bounds. Heap seed 1733, from the earlier grammar, finishes in about 7 s at 1,000,000 steps and exhausts a 3 GB heap at 5,000,000. The budget also used to be shared by all cases in a module, so one explosive program drained it for the rest. With a budget per case, the slowest final windows (seeds 1300–1399 and 1700–1799) took 120 s and 49 s; the others took 6–9 s. No final case exhausted its budget.

In the final hand-written runs, 1,005 of 1,500 heap programs and 827 of 3,000 scalar programs matched native execution only imprecisely. The largest classes are unknown numbers (709 heap, 412 scalar), SSA joins that keep both alternatives (391 scalar), optional calls on `maybe` (72 heap), and unknown strings (61 heap).

With fast-check:

| Seed     | Campaign | Cases | Time  | New defects                                                                                          |
| -------- | -------- | ----: | ----- | ---------------------------------------------------------------------------------------------------- |
| 20260923 | scalar   | 2,000 | 40 s  | 1: `"0e16" == second` compared without converting the string                                         |
| 20260923 | heap     | 2,000 | 86 s  | 2: a nested `&&=` join lost an input; `0 >> (flag ? primitive : false)` skipped `Symbol.toPrimitive` |
| 20260924 | scalar   | 2,000 | 35 s  | 2 signatures, 1 cause: SSA ignored an operation that threw on every alternative                      |
| 20260924 | heap     | 2,000 | 71 s  | 1: `list[second * -1]` was assumed to hit an item                                                    |
| 20260924 | both     | 4,000 | 101 s | none, after the fixes                                                                                |

The first corpus campaigns stalled in the harness, not the analyzer. Observing a list crossed every item's alternatives, so `alphabet(first ? 1 : -17)` from a string utility built exponentially many guarded lists and ran out of memory. A later run spent minutes on each shrink candidate of tldraw's `intersectCircleCircle`, whose result nests lists of points. Now one completion gets 10,000 observation steps, and whatever remains reads `unresolved:observation budget`. Merging lists with equal values by joining their guards looked cheaper but was not: the joined guards share subterms that the solver walks as trees, and a heap program stalled on them for 18 minutes. The worker's heap after a forced GC stays under 600 MB; its resident size grows only because V8 collects lazily under a large `--max-old-space-size`.

### Findings by root cause

Fixed, each with a minimized ordinary regression in `tests/fuzz-regression-differential.test.ts` or the relevant differential file:

| Root cause                                                                    | Example                                                 | Witnesses promoted to ordinary tests                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Loop left on paths that break after a guarded return was treated as returning | `while (true) { if (first) return 1; break; }`          | 5 new regressions                                               |
| Labeled `break` ended the function or was swallowed by an inner loop          | `outer: { for (…) { break outer; } rest(); }`           | 9 completion-matrix cells, 12 new regressions                   |
| Binary operators skipped `ToPrimitive` on objects                             | `coerce == 0`, `value + 1` with `Symbol.toPrimitive`    | 2 property-protocol witnesses, earlier coercion files           |
| Loose equality skipped coercion against each alternative of a branch          | `(first ? 1 : 0) == coerce`                             | 1 new regression                                                |
| Symbol operands accepted instead of throwing                                  | `Symbol() - 2`, `` `${Symbol()}` ``                     | 32 operator witnesses, 1 template witness                       |
| BigInt mixed with an unknown non-BigInt primitive did not throw               | `1n + flag` after `--flag`                              | 1 new regression                                                |
| `join()` printed a possibly undefined item as `"undefined"`                   | `[first ? 0 : undefined, "e"].join("\|")`               | 1 new regression                                                |
| AST evaluation read `let`, `const`, and classes before their declaration      | `{ let beta = beta; }` read the outer `beta`            | 6 regressions, each on both paths; 3 TDZ witnesses              |
| Statements after a `switch` also ran on paths that returned inside it         | `switch (0) { default: if (first) return 1; } rest();`  | 2 new regressions                                               |
| The first `switch` fix let a later `break` complete paths that had thrown     | `default: alpha += 0; case "1": break;` with a BigInt   | 1 new regression                                                |
| A throwing right operand ran after the left operand's `valueOf`               | `coerce & beta` with `beta` in its dead zone            | 2 new regressions (SSA and AST)                                 |
| An unknown Boolean key read a list index                                      | `list[first]`                                           | 1 new regression                                                |
| `String(object)` and `Number(object)` skipped the user's conversion methods   | `String(target)` with a throwing `toString` getter      | 54 ordinary-conversion and 3 `Symbol.toPrimitive` witnesses     |
| Concatenating an error ignored `Error.prototype.toString`                     | `trace += caught`, or a reassigned `error.name`         | 2 new regressions                                               |
| Loose equality against a literal of another type skipped `ToNumber`           | `"0e16" == second`, `count == "1"`                      | 2 new regressions (SSA and AST)                                 |
| Joins merged unknown primitives with different truthiness predicates          | `let alpha = second; alpha &&= first;`                  | 4 new regressions; the persisted `heap-28` repro                |
| Binary operators skipped `ToPrimitive` on an object alternative of a branch   | `0 >> (first ? primitive : false)`                      | 1 new regression                                                |
| `Array(length)` accepted a length past `2 ** 32 - 1`                          | `Array(2 ** 32)`, `Array(1e21)`                         | 1 new regression                                                |
| SSA continued normally when every alternative of an operation threw           | `trace += second; (1n / trace);`                        | 4 new regressions; 1 SSA-mode test                              |
| An unknown number index was assumed to hit an existing list item              | `list[second * -1]` reads `list[-1]`                    | 1 uncertainty test                                              |
| A loop body that forked on every iteration nested each iteration in the last  | `while (chars) { if (chars[index++] === "}") throw … }` | 1 uncertainty test                                              |
| Class methods and getters were enumerable own keys of an instance             | `Object.keys(new Box())` listed `increment`             | 1 new regression; 1 class-construction witness narrowed         |
| Spreading or destructuring a non-iterable value completed normally            | `Math.max(...0)`, `const [head] = true`, `f(...{})`     | 2 new regressions                                               |
| A tagged template's strings array had no `raw`                                | MUI's `createStyled` spreads `styleArg.raw`             | 1 new regression; the `mui-theme` fixture; 2 template witnesses |
| A strict function called without a receiver read an unknown `this`            | `function Make() { this.g = 0; } Make();`               | 1 new regression                                                |
| Calling a primitive, object, or list, or passing one as a callback, returned  | `0(0)`, `list.filter(0)`, `[].reduce({}, 0)`            | 1 new regression                                                |
| Calling a method no object on the prototype chain has returned an unknown     | `(0).filter(…)`, `{ id: 0 }.filter(…)`                  | 1 new regression                                                |
| `forEach`, `map`, and `filter` kept going after a callback threw              | `list.filter((header) => header.name.length)` on `[0]`  | 1 new regression; 3 array witnesses                             |
| Writing a property of a primitive in strict code completed normally           | `0[0] = 0`                                              | 1 new regression                                                |
| `new Number`, `new String`, and `new Boolean` returned primitives             | `typeof new Number(7)` was `"number"`                   | 6 boxed-primitive witnesses                                     |

The SSA throw was lost outside the operator model. `"" + second` is the branch `"true" | "false"`, and dividing `1n` by either alternative throws. SSA ends every coercive operation in an `invoke` terminal with a normal and an exceptional edge. It distributed over alternatives only when some might throw and took the exceptional edge only for a single thrown value, so a branch whose alternatives all threw took the normal edge. The throw survived only if a later `return` carried the value. Otherwise the next statement ran, or read the branch as an operand and deoptimized with `branch operand`.

The list read came from arithmetic, not a key the fuzzer supplies. `second * -1` is `-0` or `-1`, and a fixed-length list read with an unknown number used to choose among its items only, so `list[-1]` looked truthy and a guarded call always ran. A fixed-length list now adds `undefined` as an alternative for any unknown number key. That result is imprecise but sound, so the test asserts uncertainty rather than a value.

The loop came from shrinking path-to-regexp's `parse`, where the scanner reads an unknown character each iteration and throws on some of them. A body that forks resumes the next iteration inside the continuation of each path, so the unroller nested up to 256 iterations. Every path guard also gained the negated test of each earlier iteration. One comparison overflowed the stack after 22 s, and the original eight-way test ran for over an hour. Now at most 16 iterations may resume from a forked path; the rest of the loop becomes the uncertain tail that the unroller already uses when a `break` is uncertain. The stuck corpus case now takes 5 s.

Most corpus fixes share one cause: a value of the wrong type reached an operation that throws natively, and the analyzer returned an unknown value instead. Corpus functions get arguments from the pools, so saleor's `hasEmptyHeader = (customHeaders) => customHeaders.filter(…).length > 0` ran on a number, a plain object, and an unknown Boolean. Each shrink exposed the next gap: calling `0`, calling `{ id: 0 }`, calling a `filter` that no object on the receiver's chain has, and a `filter` callback that throws on a number. A call now throws a `TypeError` when the callee is a primitive other than `undefined` or `null`, an object, or a list, or when the method is absent from a receiver whose whole prototype chain is known. That holds for a primitive, whose chain is the native one, and for an object or list whose own keys and prototype are modeled. `values()` returns its receiver list as an approximate cursor, so a key is absent from a list only when neither `Array.prototype` nor the array-iterator chain has it: `[1].filterBy()` throws, and `[1].values().next()` still runs. Classes are excluded because their inherited statics, such as a subclass's `Promise.resolve`, are not all modeled. An excluded receiver's missing member reads as `undefined`, and calling it hits the limitation below.

The new throws exposed two models that read an absent member as present. `useTranslation()` returned a plain object with keys `0`, `1`, and `2`, so `const [translate] = useTranslation()` became a non-iterable destructure; it now returns an array carrying `t`, `i18n`, and `ready`, as react-i18next does. A declared host object such as `new FontFace(…)` had no own keys and no modeled prototype, so `load` counted as absent and the effect threw before scheduling its timer. `in` had the same bug. A host object's inherited presence is now an unknown Boolean.

Three corpus mismatches were harness bugs. Native runs shared one vm context, so a global written by one case leaked into the next; each assignment now gets a fresh context. Node's contextified global also lets strict code assign a function to an undeclared name, so d3-format's `formatPrefix = locale.formatPrefix` returned natively while the analyzer correctly threw a `ReferenceError`. The native side now runs in a `vm.constants.DONT_CONTEXTIFY` context. Finally, the timeout check tested `instanceof Error`, which a vm timeout error fails, so a timed-out case read as a thrown error instead of being skipped.

The `switch` fixes mirror loops. A finished `switch` completes its own `break` paths under their recorded condition, just as `leaveLoop` completes a loop's breaks. It then continues with the following statements only on paths that complete, so returned and thrown paths stay separate. A `continue` inside a `switch` still propagates to the enclosing loop.

SSA also reads `undefined`, `NaN`, and `Infinity` and evaluates `typeof` of an unbound identifier instead of falling back, computes bounded BigInt arithmetic exactly, and propagates a throwing `switch` discriminant.

Unresolved and still labeled:

| Root cause                                                                    | Witness                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| SSA has no object operands, so a caught error reaching `+=` deoptimizes       | `scalar-1107010e86.json` (known limitation)                                 |
| Calling `undefined` or `null` returns an unknown value, not a `TypeError`     | noted limitation; unmodeled built-in members also read as `undefined`       |
| Labeled `continue` out of an inner loop                                       | 9 completion-matrix cells                                                   |
| `for await` does not await sync-iterator values; `break` does not close       | 2 async-loop witnesses, now concrete wrong traces                           |
| `switch` evaluates every case test eagerly                                    | noted limitation                                                            |
| A `let` in a `switch` case is in its dead zone only within that case          | noted limitation                                                            |
| Module-level `let` and `const` have no dead zone                              | noted limitation                                                            |
| An unknown key on an object is assumed to hit an existing property            | noted limitation; Boolean fuzz inputs cannot reach it                       |
| A class that extends `Error` or another built-in inherits unknown members     | path-to-regexp's `PathError`; the harness reads its instances as unresolved |
| `hasOwnProperty` reports class methods and getters as own properties          | noted limitation; instances flatten their prototype                         |
| `for…of` over a non-iterable primitive is uncertain rather than a `TypeError` | noted limitation                                                            |

The campaign's other TDZ mismatches (`heap-1145`, `heap-1253`, `heap-1477`) are fixed with the dead zone, and `heap-1376` with the join fix. The persisted `heap-89` and `heap-1020` repros became ordinary regressions.

The remaining call limitation is kept deliberately. `helpers.get(key)` on a function reads `undefined` natively and throws, but the analyzer cannot tell that `undefined` from a built-in member it does not model, such as an array-values cursor method. Throwing would turn those unmodeled reads into wrong exceptions, so a call of `undefined` returns an unknown value and a discarded call statement completes normally.

Some uncertainty classes are precision gaps rather than wrong answers. Relational comparisons of an unknown Boolean against `undefined`, `NaN`, or a string stay unknown; `text[first]` on a string does not narrow to the two characters; and two `catch` blocks that concatenate messages before a class declaration lose the concrete text.

The 1,122 remaining known-defect assertions span 78 test files. The seven largest hold 472: DataView (84), numeric formatting completions (80), abrupt iterator consumers (76), format receivers (75), entry conversion and closing (70), iterator closing from `catch` (45), and promise capabilities (42). Built-in receivers and formatting, the iterator protocol and `IteratorClose`, and promise scheduling remain the largest families. Primitive conversion shrank the most, because `String()`, `Number()`, and computed keys now call user conversion methods.

## Fallback report

```sh
BIPPY_SSA_REPORT=/tmp/ssa-report pnpm --filter bippy-analyzer test tests/ssa-fixture-report.test.ts
```

`evaluate/ssa-profile.ts` is inactive unless a test starts a profile, and it only observes: it records each SSA attempt's outcome, blocker, and graph size, and times fallback bodies. An always-on test checks that profiling leaves render patterns, diagnostics, and stats unchanged. The opt-in run gives each fixture a fresh renderer and renders it once cold, with profiling. It then alternates five unprofiled and five profiled warm renders (`BIPPY_SSA_REPORT_REPEATS` changes the count) and writes `ssa-fixture-report.md` and `.json`. The full run takes about 140 s.

Over 701 targets (585 component files and 116 app fixtures):

| Measure                                             | Value                         |
| --------------------------------------------------- | ----------------------------- |
| Function invocations                                | 54,102                        |
| Direct SSA executions                               | 8,575 (15.8%), in 67 fixtures |
| Excluding `fixtures/mui-theme`                      | 329 of 11,612 (2.8%)          |
| Input fallbacks / static fallbacks / runtime deopts | 32,505 / 13,022 / 0           |
| Distinct functions: SSA only / fallback only / both | 94 / 4,288 / 7                |
| Graphs compiled; median and max compile time        | 2,991; 0.15 ms and 5.6 ms     |
| Setup / cold render / warm render (sum of medians)  | 1.4 s / 15.4 s / 11.7 s       |

Leading reasons, with measured AST self time on the cold render and the mean warm render:

| Reason                                 | Invocations | Functions | Cold ms | Warm ms | Typical names                                                   |
| -------------------------------------- | ----------: | --------: | ------: | ------: | --------------------------------------------------------------- |
| object parameter                       |       5,695 |       693 |   1,927 |   1,462 | `props`, `inProps`, `ownerState`, `state`                       |
| object outer binding                   |       4,427 |       131 |     426 |     581 | `ref.current`, `isMounted.current`                              |
| function outer binding                 |       2,082 |        50 |     470 |     468 | module helpers such as `onReady`, `record`                      |
| unbound outer binding                  |      10,022 |       747 |     410 |     230 | `generateUtilityClass`, `document.createElement`, `Math.random` |
| captured binding (static)              |       1,708 |       527 |     288 |     175 | `trace`, `calls`, state setters                                 |
| function parameter                     |       4,098 |       134 |     228 |     171 | callbacks such as `useEventCallback(fn)`                        |
| `AssignmentPattern` parameter (static) |       4,099 |        71 |     193 |     159 | default parameters, mostly MUI                                  |

Across every function that fell back, a `CallExpression` appears in 2,787 and is the only static blocker in 264. The next sole blockers are `load-reference` (70), `create-object` (34), and `store-reference` (26). Another 49 fell-back functions have no static blocker at all and are declined only by their inputs.

The hottest fell-back functions are concentrated. Three MUI `Tabs` bodies (`Tabs.js:291`, `:207`, and `:336`) account for about 1,300 warm ms between them: an object outer binding, an object parameter, and a function outer binding. `tests/components/unset-paths.tsx:19` adds 433 ms from five invocations with an object parameter. `fixtures/mui-theme` holds 3,067 ms of the fallback self time and 8,246 of the 8,575 SSA executions.

Measurement boundaries:

- Setup (module graph and parsing) is timed separately and is not profiled.
- The cold render includes compilation; the warm renders reuse the compiled graphs.
- Interleaving warm renders exposes both sides to the same drift. Per fixture, unprofiled renders spread by a median of 10% (p90 28%) of their median. Profiling costs a median of 0% and p90 2%.
- Fallback self time is a body's AST time minus nested profiled calls; it covers the whole body, not the blocked operation.
- `heapUsed` is sampled without forcing GC.
- SSA and AST timings cover different functions, so the report supports no speedup claim.

### Next SSA operations

1. **Property loads from object inputs.** Object parameters carry the most measured fallback time, 1,462 warm ms. A read-only `load-property` on an opaque object handle, delegated to the heap model and keeping receiver identity, would admit prop-reading helpers. It needs heap-journal reads, not a new object model.
2. **Host-delegated calls.** Calls are the most common static blocker. A `call` instruction that passes callee, receiver, and arguments to the interpreter, sequenced by the existing effect token, would reuse AST semantics for the callee. A deoptimization must not follow an admitted call, because calls run application code.
3. **Immutable module bindings and host globals as inputs.** `unbound outer binding` is the most frequent reason. Imports and known globals can enter as opaque inputs, which is cheap only once 1 and 2 give them uses.
4. **Mutable captured cells.** Cell load and store through the interpreter's scopes and journals are required for closures such as `trace += …` and for heap aliasing.
5. **Object operands through the host.** `scalar-1107010e86` (formerly `scalar-110`) is the only way the scalar campaigns leave SSA: a caught error reaches `+=`. Delegating `ToPrimitive` on an object operand to the interpreter would remove it. The AST defects fixed above are the ordering rules that delegation must keep: the right operand throws before the left's `valueOf` runs, `String()` uses the string hint, and errors print through `Error.prototype.toString`.
6. **Default and destructuring parameters.** They are cheap to lower but mostly help after property loads.

For precision rather than coverage, the largest fuzz uncertainty class is an unknown number from arithmetic or updates on unknown values (709 heap and 412 scalar programs), and 391 scalar programs keep both alternatives of a join. Joins now keep unknown Booleans with different truthiness predicates apart, which fixed `heap-28`; keeping unknown numbers apart by the input they came from would sharpen both classes. The predicate comparison has a cost: a corpus Levenshtein distance that exhausts its 5,000,000-step budget takes 127 s instead of 93 s. Predicates cannot be cached per value across joins, because derivations attach to a value after it is created. Within one join nothing changes, so `branchValue` serializes each alternative's predicate once instead of once per pair. That cut a path-to-regexp shrink candidate from 695 s to 159 s.

No fixture exercised a runtime deoptimization, so that path's correctness rests on the unit and fuzz tests.

## Source revisions

The repositories were cloned locally. These are the revisions and relevant passes inspected, not claims to have audited their entire codebases.

**React:** `59aff3e18cb5b3a336c280bbfa57ec37999511b9`

- [Pass pipeline](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/docs/passes/README.md)
- [SSA construction](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EnterSSA.ts)
- [Redundant-phi elimination](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/SSA/EliminateRedundantPhi.ts)
- [Type inference](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/TypeInference/InferTypes.ts)
- [Mutation and aliasing model](https://github.com/facebook/react/blob/59aff3e18cb5b3a336c280bbfa57ec37999511b9/compiler/packages/babel-plugin-react-compiler/src/Inference/MUTABILITY_ALIASING_MODEL.md)

**Oxc:** `30add53b4386c86b001e7061a547e496910efe0d`

- [SSA construction](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_ssa/enter_ssa.rs)
- [Redundant-phi elimination](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_ssa/eliminate_redundant_phi.rs)
- [Type inference](https://github.com/oxc-project/oxc/blob/30add53b4386c86b001e7061a547e496910efe0d/crates/oxc_react_compiler/src/react_compiler_typeinference/infer_types.rs)

**TypeScript:** `5f6db9c9148635b4cbf72f1193b821b9c6b42dcc`, plus v6.0.3 at `050880ce59e30b356b686bd3144efe24f875ebc8`

- [Current Go flow checker](https://github.com/microsoft/TypeScript/blob/5f6db9c9148635b4cbf72f1193b821b9c6b42dcc/tsc/internal/checker/flow.go): equality, Boolean, and compound narrowing; flow-state and reference handling.
- [v6 checker](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/src/compiler/checker.ts): the corresponding TypeScript narrowing algorithms.
- [v6 binder](https://github.com/microsoft/TypeScript/blob/050880ce59e30b356b686bd3144efe24f875ebc8/src/compiler/binder.ts): assignment flow and the predecessor edges for logical expressions.

The TypeScript and React adaptations retain [attribution and their Apache 2.0 and MIT licenses](../third-party-notices.md). The React passes were adapted to Bippy's representation, not imported wholesale. No Oxc source was extracted.

## Validation

The change adds 48 tests across `tests/flow-narrowing.test.ts` and `tests/flow-narrowing-differential.test.ts`. They cover sequential `typeof` refinement, strict literals, Boolean comparison identity, getter effects, predicate-callee getters, captured reassignment, and callbacks that overwrite a tested binding. Boundary tests reject loose literal substitution and positive-zero substitution.

The differential tests select each Boolean assignment from one combined analysis and compare every surviving outcome with native execution. They also enumerate and replay symbolic render outcomes. Those render tests now supply explicit unknown-Boolean parameters; a `declare const first: boolean` annotation alone does not establish the runtime input domain.

The SSA work adds 7,662 tests. The original 157 include native read-fact checks, direct executor tests that distinguish execution from fallback, guarded return/throw comparisons, and structural CFG tests in `tests/ssa.test.ts` and `tests/ssa-construction.test.ts`. Those structural tests include parallel predecessor edges, irreducible control flow, genuine loop recurrences, a 12,000-edge predecessor chain, and a 5,000-phi cycle. An architecture test prevents compilation from depending on evaluation or rendering.

The expanded suite adds 7,505 tests:

| File under `tests/`                | Tests | Checks                                                                                                                                             |
| ---------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssa-operators.test.ts`            | 4,740 | Scalar operator matrices through parameters and folded literals; short-circuit effects, assignments, updates, and execution without constant facts |
| `ssa-completion-matrix.test.ts`    | 1,262 | Try/catch/finally combinations of normal, return, throw, break, and continue; concrete and guarded native comparisons                              |
| `ssa-control-flow.test.ts`         |   552 | 256 seeded programs under concrete and symbolic inputs; simultaneous loop phis and switch evaluation order                                         |
| `ssa-bindings.test.ts`             |   152 | TDZ, immutable writes, shadowing, catch-var initializers, closure capture classification, and `arguments` ownership                                |
| `ssa-constant-propagation.test.ts` |   592 | Executable-edge selection, scalar joins including NaN and signed zero, exception edges, and nontrivial phi cycles                                  |
| `ssa-generated-graphs.test.ts`     |    64 | Five-join graphs checked against native assignments under all 32 branch selections, before and after optimization                                  |
| `ssa-boundaries.test.ts`           |    64 | Fallback, budget restoration, compilation limits, dead effects, fresh execution registers, and mixed return/throw continuations                    |
| `ssa-refinement.test.ts`           |    48 | Equality aliases, overwritten definitions, signed-zero uncertainty, and symbolic scalar comparisons against NaN                                    |
| `ssa-verification.test.ts`         |    31 | A valid control graph and 30 malformed graph mutations                                                                                             |

Direct scalar comparisons require SSA execution, not fallback. They compare values with `Object.is`, preserving NaN and signed zero, and distinguish primitive throws from error names. The native wrapper uses the same parameter bindings as the compiled function. Guarded tests check input-to-outcome associations rather than unordered result sets. Generated seeds are fixed for reproducibility; they do not exhaust possible programs.

The new tests exposed and drove fixes for four execution cases: a catch-local `var` initializer overwriting an outer parameter, `in` bypassing AST error handling, primitive `instanceof` returning uncertainty instead of throwing, and known NaN equality retaining impossible scalar matches. They also exposed 13 malformed graph shapes that verification previously accepted. The verifier now checks graph identities, edge ownership and uniqueness, terminal shapes, and phi-variable consistency before accepting the graph.

Seven existing known-defect cases now match native execution and are ordinary regressions: five temporal-dead-zone cases, a switch-case scope case, and an immutable-write case. Other known defects were not relabeled.

Final validation:

- Coverage: 23,301 tests passed across 367 files, including all 587 component fixtures.
- Ordinary assertions: 21,948. Known-defect assertions: 1,353.
- Typecheck, touched-file lint, formatting, and architecture tests passed.
- Strict compatibility still failed: known defects remain, and 238 source files lack complete coverage. No test or source files were missing from the report.

These passes do not establish complete JavaScript or React compatibility. Unsupported execution histories remain, and no corpus performance measurement was made for this change.

After the fuzzer, fallback report, and fixes above:

- Coverage: 23,390 tests passed across 371 files; 3 failed and 4 were skipped. The failures are environmental: the browser-capture test needs a Playwright Chromium that isn't installed, and two `Reflect.construct` argument cases also fail at the starting commit under this Node build.
- Ordinary assertions: 22,268 (was 21,948). Known-defect assertions: 1,122 (was 1,353). The decrease comes from witnesses that now match native execution and from the fixed `heap-28` repro; none were relabeled without a passing native comparison.
- Final fuzz campaigns: 2,000 scalar and 2,000 heap cases from fast-check seed 20260924, with no new mismatch, crash, or fallback.
- Typecheck, touched-file lint and formatting, `git diff --check`, and architecture tests passed.
- Strict compatibility still fails: known defects remain, and 239 source files lack complete coverage, one more than before because of the new `evaluate/ssa-profile.ts`.
