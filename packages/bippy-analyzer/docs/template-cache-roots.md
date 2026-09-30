# Template-cache GC roots

`Realm.mark` now marks each template cache entry’s guest `Array`, not the plain native `{ Site, Array }` record. The collector does not traverse arbitrary native records. Marking the array also retains its frozen `.raw` array through the existing property marker.

The predecessor clears WeakRefs to these arrays even though a subsequent call at the same tagged-template site returns the original array. The patch changes two lines in the existing marker. `GetTemplateObject`, template allocation, freezing, cache keys, records, and array identities are unchanged.

## Evidence

All 12 exact final-source predecessor cases fail; all 12 maintained cases pass. Each first checks an independent Node execution. The matrix covers cooked and raw array targets for empty, plain, escaped, invalid-escape, and interpolated templates. Repeated calls preserve identity, frozen state, strings, and substitution results across collection. Separate equal-text sites remain distinct; closures sharing one syntactic site reuse its array.

The tests inspect the original cache/list identities, then explicitly clear the cache to verify collection. Clearing native storage is a root-removal control, not a guest API or module-unloading policy.

All 1,987 units across 71 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. [Receipts](template-cache-root-validation/summary.json) retain the initial and final-source baselines, current runs, and source hashes. A test title was corrected between baselines; its assertions and guest programs did not change.

### Conformance limits

The new source run passes 650 of 651 selected variants: 603 weak-reference/finalization variants and 47 of 48 tagged-template variants. Published weak results are reused; the published tagged-template run is fresh and passes 46 of 48.

Input and compiled hashes match. Verdicts differ for strict `tagged-template/tco-member.js`: source passes; published reports a file-location error. Both fail strict `tco-call.js`, but source times out and published reports a file-location error. A fresh predecessor-source tagged-template run also passes 47 of 48 with the same timeout. These are not fixes from this marker change, and the differing failure causes remain undiagnosed. No cases or time limits were removed to obtain a green report.

## Remaining work

The patch roots live cache arrays. It does not checkpoint the cache, own its parse nodes or native entry records, or establish transitive React isolation. A selected native-list snapshot remains shallow: saving these records does not automatically root or restore their referents. Branch ownership still needs an explicit policy.

Reachable realms retain their cached arrays. No eviction, eager collection, allocation bound, or host sandbox is added. The React compiler’s tagged-template lowering was inspected but is not used; engine262 still evaluates application JavaScript. These tests do not demonstrate React transitions, a guarded tree, or symbolic lazy/Suspense behavior.
