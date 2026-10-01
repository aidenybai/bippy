# Completed module roots

The collector now follows completed builtin module-cache entries and a reachable script record’s loaded modules. This preserves exports and namespaces needed by repeated imports. It does not snapshot either storage structure.

## Reproduced failures and changes

The predecessor clears WeakRefs to exported objects, symbols, and namespaces after import jobs finish. A later import still returns the original value, but its WeakRef has already been cleared. The same failure occurs with a loader that reuses `ScriptRecord.LoadedModules` without storing results in a host cache.

The patch adds three links using existing records:

- `Realm.mark` marks `HostDefined.resolverCache` when it is a builtin `ModuleCache` instance.
- `ModuleCache.mark` visits completed entries in its original private Map. Existing module and completion markers handle the results.
- `ScriptRecord.mark` visits each `LoadedModules` entry’s original module.

The cache, request lists, module instances, and completion identities remain unchanged. Native pending Promises in cache entries are not traversed. The separate pending-request registry still owns the implemented [pending capability roots](module-load-roots.md).

## Tests and native differences

The final 13 tests pass. The exact predecessor fails all eight engine cases and passes five native controls. Engine cases cover cached exports, symbols, namespaces, syntax failures, evaluation failures, and script-associated modules. They force collection, repeat the import, verify identity, then detach the cache or importing function and verify collection.

Four native controls confirm retention through completed data-URL imports. An initial fifth retention oracle expected Node to retain a syntax-error object. Node collected it. A separate comparison with both errors strongly referenced shows distinct instances for repeated imports of that invalid module.

The final native retention controls exclude that syntax failure. The engine test still checks its existing cached-error identity. This is a narrowed oracle with the failure retained, not a change to parser behavior or a claim of Node error-identity parity. The [validation receipts](module-cache-root-validation/summary.json) preserve the initial failure and the exact final-source predecessor run.

All 1,975 units across 70 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. New source conformance passes 675 variants. Input, compiled, and verdict records match the reused published weak-reference and module selections.

## Remaining boundaries

These links establish retention, not branch restoration, complete module reachability, or general React ownership. Custom cache types, arbitrary host metadata, and callbacks remain outside this traversal. Pending referrers and other asynchronous module fields still require an audit.

A reachable builtin cache retains its completed results. This patch adds no eviction, cancellation, or eager-collection policy. Detaching the cache in a test removes that root; it does not define application module unloading. Hosts must provide valid marker implementations and storage. The collector is not a sandbox or a bound on native work.
