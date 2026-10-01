# Native lexical scopes during control lowering

The build now preserves ordinary native `let` and `const` scopes. It uses Babel’s block-scoping visitors only inside generator scopes. Native class capture getters therefore retain the temporal dead zone (TDZ): reading a later binding before initialization throws `ReferenceError`.

This repairs the full-pipeline discrepancy recorded in [native class captures](native-class-captures.md). Both the metadata-only transform and the full pipeline now run that original test. Capture of an uninitialized native binding fails before owner capture, without consuming the paused continuation. After initialization, capture and resume succeed.

An illegal assignment does not make a native `const` mutable. Its manifest no longer exposes a setter even when Babel records a constant violation. Captured references still do not own their referents.

## Reuse and rejection boundaries

`engine/scripts/lower-generator-bindings.ts` delegates generator loop and variable lowering to pinned Babel block-scoping 8.0.5. Regenerator 8.0.6 still performs control lowering. The build does not replace either compiler’s algorithms.

The compiler rejects these native source forms before mutating visitors run:

- Variable and function declarations in nested native methods or static blocks that regenerator’s hoister would traverse.
- Generator-local class declarations. A constructor declared before a yield otherwise loses its initialized binding on resume.
- Block-scoped function declarations inside generators. Regenerator otherwise combines distinct shadowed bindings.
- Native async functions and async generators. The existing helper integration already failed with `Missing machine emitter`; the new rejection states this boundary before lowering.

These restrictions apply to native engine implementation and control fixtures, not guest application syntax interpreted by engine262. Supported controls include generator method shadowing, const-write errors, per-iteration closures across yields, class expressions, and body-level function declarations. Ordinary function boundaries preserve nested native methods and static blocks.

Preflight must run before loop wrapping. A captured-loop reproduction returned `7` instead of native `0` when Babel moved a static-block `var` declaration into the generator. Checking declarations only when their visitors ran missed that mutation. Preflight now rejects it. A readonly review identified this bypass; the failing tests and concrete observations remain in the receipts.

## Remaining limitations

This is not general generator lexical parity. A generator-local read before a later `const` still returns `undefined` instead of throwing. The [saved probes](native-lexical-scope-validation/probes.json) retain that mismatch. Generator binding phase and complete native execution ownership remain unresolved.

The React diagnostic still rejects its first branch timer in both orders. It executes one prefix, saves one timer, and returns no branch observations. Its 21 unregistered functions remain unsupported; stable discovery counts do not establish ownership. Class fields, prototypes, private state, callbacks, module records, and host effects still need their existing separate policies.

React’s `constructClassInstance` still calls the original constructor and stores its state and instance on the fiber. The inspected React revision is `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. No React algorithm or constructor call was replaced.

## Verification

The [receipts](native-lexical-scope-validation/summary.json) preserve final tests, source hashes, intermediate failures, raw conformance reports, and React diagnostics.

- Exact final-source predecessor: 23 failures and 22 controls. Maintained implementation: all 45 focused tests pass.
- Full suite: 2,115 tests across 77 files. Typecheck and two relocated source builds pass.
- Fresh source and published engines: 201 matching Test262 variants, including input hashes, compiled hashes, and verdicts.
- The unchanged 74-case local smoke selection passes with two workers and a 10-second timeout. Unit timeout remains five seconds.
- The earlier global `{tdz: true}` experiment failed capture getters generated after lowering. Its failures remain recorded.
- An initial conformance command failed with `ENOENT` for a nonexistent yield-star directory. Its interrupted JSON and stderr remain recorded, without coverage claims. The final selection uses `language/expressions/yield/*.js`.

These checks do not complete the general React owner, guarded transitions, repeated-state families, or the symbolic demo.
