# Checkpoint compilation boundaries

Agent evaluation checkpoints now reject dynamic compilation and source registration through the guarded entry points. This closes a native-state leak needed by the future synchronous-Script owner. It does not snapshot compiler state or implement that owner.

## Reproduced effects

Before this change, an open checkpoint permits `eval('counter++')`, `Function('return 7')()`, and `JSON.parse('7')`. Each adds one Agent source-registry entry and calls `onScriptParsed`. Eval and Function also call `HostEnsureCanCompileStrings`; JSON parsing does not use that hook.

The same source-built-engine probe now records zero compile-hook calls, zero parsed-source callbacks, and zero added registry entries. Each operation throws the existing native TypeError before registration. Guest catch blocks do not intercept it.

## Guarded entry points

The patch calls the existing `assertCanPerformHostEffect()` before these operations:

- `HostEnsureCanCompileStrings`, before host-hook lookup or invocation
- `ParseScript` and `ParseModule`, before option reads or parsing
- `ManagedRealm.compileScript` and `compileModule`, before `pushTopContext`
- `Agent.addParsedSource` and `addDynamicParsedSource`, before metadata reads, cache lookup, registry writes, callbacks, or identifier changes

The registry methods check both their recipient Agent and a different surrounding Agent. Cached dynamic sources and `doNotTrackScriptId` do not authorize compilation while a checkpoint is active. The guards apply during capture, restoration, and the open-checkpoint lifetime, including after terminal completion. Releasing the checkpoint permits these operations again.

The compile wrappers need their own first-operation guard. Relying only on `ParseScript`/`ParseModule` would reject after `pushTopContext`, leaving a changed context stack. Tests check original membership, no helper getter access, unchanged source records, and the next assigned identifier.

## JSON and coercion behavior

This boundary also rejects **valid `JSON.parse` and `JSON.rawJSON` during Agent evaluation checkpoints**. Original engine262 `ParseJSON`, in `src/intrinsics/JSON.mts`, validates JSON and then calls `ParseScript`. It creates and evaluates a Script and registers its source. Exempting JSON without owning those effects would reopen the leak.

JSON validation still precedes Script parsing. Invalid JSON can therefore produce a catchable guest SyntaxError before reaching the guard. The same distinction applies to the internal `ParseJSON` operation and public `ParseJSONModule`. Tests access the internal helper through compiled capture metadata; no API export was added. `JSON.stringify` does not use this compilation path and remains available.

Dynamic Function constructors still coerce parameters and body text before calling the host compilation hook. Those guest writes are not rolled back. A test records coercion order as 12 before the boundary throws. A coercion exception retains its original guest identity and catch behavior. Non-string eval arguments return normally, and guest replacements named `eval` or `Function` are not blocked by name.

## Failure and ownership limits

A native boundary failure during registered evaluation bypasses guest catch and retains the original Agent failure/poison protocol. Repeated resume and restore throw the same error. Direct API rejection outside resume leaves the pause intact; tests release the checkpoint and continue. Failed capture publishes no evaluation checkpoint. Trusted effects that occur before the guard are not rolled back, and poisoned Agents have no safe-reuse promise.

This is not a general parser, heap, or capability barrier. Direct native mutation of public records, raw Parser use, `wrappedParse`, RegExp parsing, and arbitrary host implementations remain trusted. Standalone selected-storage or control snapshots do not acquire Agent evaluation-checkpoint guards. Existing syntax-region validation, snapshots, roots, and source provenance do not authorize compilation.

No replacement interpreter, parser, generic native copier, public snapshot API, or restore algorithm was added. Original algorithms continue outside the guarded lifetime.

## Verification

Seventy-six focused compilation cases pass. The exact final-test predecessor records 62 failed boundary assertions and 14 existing controls. These failures reproduce missing rejection, not missing APIs or 62 independent defects. A separate before/after probe records the three registry leaks above.

Two existing evaluation-checkpoint cases previously compiled their replacement evaluator inside an assertion about starting evaluation. The new earlier compilation guard changed that diagnostic. The fixture now prepares the replacement before capture and still verifies the original evaluation-start error and later reuse. All 14 cases in that file pass against the exact predecessor too.

Final local checks pass 141 focused cases, 2,545 units across 103 files, types, two relocated builds with identical engine bytes, offline installation, and the root check. The unchanged 74-case smoke passes. Unit/Test262 timeouts remain five/ten seconds, with two Test262 workers and a ten-minute CI job limit.

Fresh eval, Function, JSON.parse, and JSON.rawJSON conformance covers 443 variants. The maintained engine, exact predecessor, and published engine each pass 422 and fail the same 21 Function caller/arguments cases. Input, compiled-source, and verdict hashes match. This is reference agreement, not 443 passes. The [validation receipt](checkpoint-compilation-validation/summary.json) retains all results, intermediate type/fixture failures, and the initial unused-import warning.

Predecessor `60b4c28c` CI36768246583 fails the analyzer smoke gate: 2,469 units pass, but two numeric-substr variants time out, yielding 72/74 smoke passes. E2E36768246639 and publish36768246654 pass. One-worker, thirty-second diagnostic runs take 13.156/13.093 seconds and do not change the failed gate verdict.

Automatic execution ownership, complete Realm/Script/context/native capability policies, accepted shared-prefix React branches, automatic reports, transitions, repeated families, and the integrated demo remain incomplete. This closes one future-writer boundary; it is not new React isolation evidence.
