# Selected RegExp properties

`regexp-checkpoints.patch` lets `createStateCheckpoint` select initialized engine RegExp objects. It restores their existing property tables, prototypes, extensibility, and constructor tracking. This includes `lastIndex`, its descriptor, and custom properties. It does not recompile the pattern or replace the original matcher.

The patch exposes the existing slot list used by `RegExpAlloc`. Error and RegExp selection share the existing read-only descriptor validator. No parsing, matching, indexing, replacement, or backtracking algorithm changes.

## Metadata and ownership

The original `RegExpMatcher`, `OriginalSource`, `OriginalFlags`, `RegExpRecord`, and `parsedPattern` fields remain read-only. The last two are engine fields outside the declared slot list. Capture and restore validate their descriptors without invoking metadata getters. Changed values, descriptor flags, layout, or internal methods reject before property writes. Incomplete matcher metadata rejects.

The matcher’s captures, record contents, and parsed pattern remain separate native storage. A test mutates the original record and verifies that property restoration does not undo that mutation. This API does not own a running matcher, independent string iterators, or referenced guest objects. Ordinary-only, closed-data, and private-instance restrictions remain unchanged.

Engine source inspection found fresh input/capture state in `CompilePattern` for each match. `RegExpInitialize` creates the stored fields. The checkpoint reuses those fields and does not call either algorithm during capture or restore.

## Native comparison limits

The first matrix exposed an existing engine/native discrepancy when `lastIndex` points inside a surrogate pair. The maintained and published engines agree with each other:

- `/[😀a]+/gu` at index 1 matches the trailing surrogate and following characters. V8 matches the whole code point at index 0.
- `/()/gu` at index 1 causes an engine host assertion in `GetMatchString`. V8 returns an empty match at index 0.

The second case leaves three contexts active, instead of the initial one. The isolated diagnostic abandons that Agent and restores the surrounding Agent. It makes no unwind or recovery claim.

The final checkpoint matrix starts Unicode matches at code-point boundaries. The original failures, independent source/published/V8 probe, and inspected specification clause remain in [validation receipts](regexp-checkpoint-validation/summary.json). This narrows the matrix; it does not resolve the discrepancy or establish full RegExp parity. A separate fixture typo, `/a/g/`, was corrected to `/a/g`.

## React and verification

The React source checkout at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` uses a stack-prefix regex in `shared/ReactComponentStackFrame.js`. The installed React/Test Renderer 19.3.0 probe now accepts its previously rejected RegExp object. Four assignments each accept 2,194 of 2,197 visited guest objects. Three WeakMaps still reject.

The probe captures and releases selected storage, then rejects broader ownership. It never restores React. Native records, contexts, captures, queues, effects, and references omitted by marking-based discovery remain unresolved.

`tests/regexp-checkpoint.test.ts` contains 35 cases. The exact final fixtures fail all 35 against the preceding engine, without timeouts. All 35 pass with the patch. Eight pattern forms run both orders, comparing 32 branches and 16 initial baselines with V8. Tests verify original matcher/object/table identities, getter-free capture, descriptor preflight, frozen `lastIndex`, saved roots, nesting, and shallow native records. Two Agent runs compare four branches with one prefix per run and GC at each restore.

Local gates pass 1,649 tests across 52 files, typechecking, and the unchanged 74-variant smoke. Source and published engines pass 442 selected exec/test/replace/flags/source conformance variants. Input hashes, compiled hashes, and verdicts match. Both commands exit zero. Two relocated builds produce SHA-256 `c3e070cce0747909304b4d0ff32a98824f25eb06931ea67d16cb792eb3792d31`.

[Linux CI for this revision](regexp-checkpoint-validation/ci-failure.json) passes 1,649 units with the matching engine hash. Both numeric `substr` smoke variants time out, leaving 72/74 passing. E2E and publish pass. Archived 30-second diagnostic profiles do not satisfy the unchanged ten-second gate.

General React ownership, shared-prefix trees, guarded reports, transitions, repeated families, and demo integration remain incomplete.
