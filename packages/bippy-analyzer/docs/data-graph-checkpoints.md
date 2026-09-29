# Closed guest-data graph checkpoints

`createDataGraphCheckpoint({ roots, maxObjects?, maxEntries? })` captures all supported data reachable from its guest-object roots. It reuses the selected-object snapshot implementation and its Agent-owned roots. It is not a complete execution-state or React owner.

## Graph boundary

The scope is `closed-data-graph-v1`. Capture follows these engine records without calling guest getters or iterators:

- Object prototypes and own property descriptors, including non-enumerable and Symbol-keyed properties.
- Map keys and values, using the original internal records.
- Set members, using the original internal list.

Ordinary objects, canonical arrays, Maps, and Sets use the existing storage restrictions. Cycles and aliases retain their original identities. Primitive values are retained without reading opaque payloads. Function references, weak collections, proxies, promises, typed arrays, private state, and other unsupported records reject capture.

Every reachable prototype also belongs to the graph. Consequently, an ordinary `{}` is currently rejected: its prototype leads to unsupported native functions. The accepted fixtures use null-terminated data-only prototype graphs. There is no borrowed-intrinsic exception, skipped prototype, implicit function boundary, or generic native-object walker.

Capture finishes traversal and validation before registering the existing checkpoint frame. A rejection leaves the shared checkpoint stack unchanged. The existing `createStateCheckpoint` API remains explicitly selected; it does not gain implicit traversal.

## Restore and release

The result provides `objectCount`, `entryCount`, `restore()`, and `release()`. Restore uses the original property tables, Map lists and entry records, Set lists, prototypes, and extensibility state. It restores reachable objects selected at capture, including objects whose incoming edges were later removed. The existing collector marks those saved records until release.

The graph checkpoint shares the same Agent and LIFO rules as selected-state checkpoints. Release removes snapshot roots without rewinding current state. It does not cancel execution or resources.

Selected objects restore even when external aliases reference them. External bindings, objects outside the captured graph, jobs, execution contexts, and host writes do not restore. It cannot prevent a branch-created value from escaping outside the captured graph. Use a separate declared context policy and `Agent.captureEvaluation` for control restoration. Neither API by itself proves general branch isolation.

## Capture limits

`maxObjects` defaults to 10,000 distinct objects. `maxEntries` defaults to 100,000 traversal entries. Both must be positive safe integers.

Each root reference, object prototype, property descriptor, Map record, and Set slot consumes one entry. Deleted collection positions still count. Repeated roots consume entries but do not duplicate object snapshots. Root selections are copied by index using a captured length; custom root iterators are not called.

The limits bound traversal units during capture, not bytes or all native work. They do not bound parsing, allocation, host getters in supplied metadata, garbage collection, or branch-created state cleared during restoration. Existing prototype validation can also cost more than linear traversal. Engine metadata remains trusted; this API is not a sandbox.

## Verification

`tests/data-graph-checkpoint.test.ts` has 23 cases. The first baseline reported 12 failures and eight misleading passes: broad rejection assertions accepted the missing API error. After narrowing those assertions to expected diagnostics, all twenty initial cases failed. Both logs are retained.

Four native branch observations and two baselines cover cyclic data, aliases, prototype edges, arrays, Maps, and Sets in both orders. Four further V8 comparisons use Agent-owned abstract decisions over the same initialized graph. The common prefix runs once per branch order. Only a declared context-stack list and closed data graph are restored in that fixture.

Additional tests cover collection-only references, Symbol-keyed children, guest-getter rejection, unsupported state, exact limits, collection tombstones, invalid budgets, copied roots, custom root iteration, LIFO release, foreign-Agent descendants, failed-capture cleanup, and removed-descendant GC retention.

React revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` defines fiber links and state in `ReactFiber.js: FiberNode`. Its `return`, `child`, `sibling`, and `alternate` links form a graph alongside props, state, and update queues. The current closed-data policy cannot own that full graph, including function and intrinsic references. This source inspection is not React branch-isolation evidence.

The full local suite passes 1,434 tests across forty-three files. The unchanged smoke passes 74/74. Object.create, Reflect.ownKeys, Map.set, and Set.add conformance passes 736/736 in both engines with matching input hashes, compiled hashes, and verdicts. Typechecking, two relocated builds, frozen offline installation, and the root check pass. The [receipts](data-graph-checkpoint-validation/summary.json) retain the exact scope and logs.

The engine SHA-256 is `6889e6071d100ee410dd643112bfc50c0d23d9746668ae8e1393da670b596c0d`. [Linux CI](data-graph-checkpoint-validation/ci-failure.json) passes all 1,434 units and reproduces that hash, but fails both numeric `substr` smoke variants at the unchanged timeout. The separate E2E and publish workflows pass. The archived 30-second diagnostic profiles do not satisfy the 10-second gate. General state ownership, guarded React output and transitions, and symbolic demo integration remain incomplete.
