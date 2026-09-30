# Scoped GC roots for observation and capture

The Boolean explorer now retains terminal completions while its observer runs and while it copies the observer’s outcome. Previously, an object returned without a fork could lose its WeakRef target during observation. Agent notification roots had already ended, and no checkpoint retained the completed evaluator.

## Synchronous root scopes

`Agent.withGCRoots(roots, callback)` retains the supplied references for one synchronous callback call. The Agent must be the current surrounding Agent. The method copies root-list membership, preserves referenced identities, and returns the callback’s original result. It removes the scope in `finally`, including when the callback throws. Nested scopes preserve outer roots.

The scope ends when the callback returns, even if it returns a Promise. It does not retain asynchronous work or values held after the call. Copying the root list does not copy referenced storage, freeze it, or make it reversible.

The method reuses the Agent’s existing active-root stack and collector. Registered native captures use their current getters. Unregistered functions and arbitrary native records remain opaque, including frozen records. Native iterators, getters, marker methods, and callbacks remain trusted. Root-list construction and callback work have no new execution or allocation budget.

The explorer uses this scope around both `observe(completion)` and report append. Outcome getters therefore run while the completion remains rooted. The scope ends after copying and validation, or on observer/report failure. This does not retain arbitrary observer captures, authorize effects, or make caller serialization complete.

## Discovery and checkpoint publication

Explicit scoped values also enter Agent checkpoint discovery. Declared bindings use the existing capture and restoration logic. An owner can reject a scoped dependency through `references` before its `capture` callback runs. Saved checkpoint roots keep these values after the temporary scope ends.

A second lifetime gap existed during capture itself. A later metadata getter or `owner.capture` could replace a captured binding and force GC. The collector then saw the replacement, but not the saved value awaiting checkpoint publication.

`captureControl(iterator, owner, getAdditionalRoots?, onCaptureRoots?)` now supplies an optional capture-root listener. It receives the live, initially empty discovery-value array under the existing control guard, before `beginCapture`. The Agent roots this array throughout discovery and owner capture. Each recorded value becomes reachable before subsequent hooks run. The Agent snapshots external scope membership before creating this internal retention scope, so it does not add its own discovery array to the owner’s graph.

After capture returns, the original Agent checkpoint frame supplies saved roots. Capture failure removes the temporary scope and publishes no frame. It does not undo hook mutations. Listener failure preserves its original error and clears the control guard. Standalone control callers receive no automatic Agent roots unless they arrange retention themselves. The listener does not protect values before discovery records them.

## Evidence and limits

The three new test files cover 23 cases:

- `scoped-gc-roots.test.ts` covers root-list copying, objects/Symbols, nested scopes, return/error identity, synchronous Promise boundaries, and foreign-Agent rejection. It also checks declared versus opaque captures, saved roots, binding restoration, owner rejection, capture-time collection, listener failure, and unchanged host-effect rejection.
- `boolean-observation-roots.test.ts` covers no-fork normal/throw results, outcome getters, failure cleanup, and both traversal orders. Each branch test uses one prefix and one fork. Reports remain unverified.
- `boolean-observation-react.test.ts` reads a returned snapshot container from an actual React mount/update. It verifies retention during observation and collection afterward, then unmounts. This is a concrete no-fork check with caller serialization, not React isolation or new native-render parity evidence.

The final-source predecessor fails 21 cases and passes two branch controls. Those controls already retained their results through checkpoints and did not expose the no-fork gap. Missing public API and listener behavior account for part of the failures; these are not 21 independent engine bugs. The initial implementation also failed both capture-time collection regressions before the live discovery array was rooted.

[Validation receipts](scoped-gc-root-validation/summary.json) retain those failures and the final 116 focused cases, 2,309 unit tests, and unchanged gates. Fresh source and published Test262 runs match for 181 concrete WeakRef/yield variants. Those variants do not exercise this native root API.

GC retention is not an ownership policy. The host-effect guard remains enabled. General React branch isolation, automatic reports, guarded transitions, repeated-state families, and the integrated demo remain incomplete.
