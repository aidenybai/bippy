# Selected array checkpoints

`createStateCheckpoint({ objects })` now accepts engine arrays as well as ordinary objects. It restores array state in the existing property table. It does not copy arrays, discover reachable elements, or create an independent React heap.

`createOrdinaryObjectCheckpoint` keeps its ordinary-only contract and still rejects arrays. The combined API keeps scope `selected-objects-and-bindings-v1`; `objectCount` includes selected arrays and removes duplicate identities.

## Existing engine representation

Engine262's `ArrayCreate` allocates an object with `Prototype` and `Extensible` slots. It replaces only `DefineOwnProperty` with the array algorithm. The `length` data descriptor and indexed elements use the same property table as ordinary objects.

`array-checkpoints.patch` extracts the existing method-identity checks into `hasOrdinaryObjectMethods`. `isOrdinaryObject` still requires the ordinary `DefineOwnProperty`. The combined checkpoint also permits the exact engine array definition method. All other methods must remain ordinary. Existing private state, constructor tracking, and additional internal slots still reject.

Capture saves the accepted definition-method identity alongside the existing snapshot. Restore checks all selected objects' method identities before changing their data. It then uses the existing descriptor, prototype, extensibility, empty-private-list, and constructor-tracking restoration. It does not call array setters, guest getters, proxy traps, or the array length algorithm during restoration.

This preserves engine object, property-table, descriptor, and element identities. Holes remain absent properties, and saved `length` flags remain intact. Subsequent guest writes still use engine262's array algorithms. Native snapshot work depends on stored properties, not the numerical array length. Callers must still bound selected records and properties.

## Verification

`tests/array-checkpoint.test.ts` adds twenty-one cases. All eighteen initial cases failed before implementation. The final cases cover:

- Holes, aliases, cycles, symbols, descriptor order, and accessors that must not run.
- Growth, shrinkage blocked by a non-configurable index, readonly length, and freeze/seal reversal.
- Sparse maximum array length without filling holes.
- Combined declarative-binding restoration and shared LIFO access.
- Saved Object/Symbol element roots and release.
- Changed-method, preview, prototype-cycle, proxy, typed-array, private-state, and foreign-Agent rejection.
- Private brands installed after capture.
- Unselected element mutations and iterator positions that intentionally do not rewind.

Four branch scripts run in both visitation orders. Their observations match eight independent V8 runs. Baseline, maximum-length, and readonly-length observations also match V8. These comparisons verify selected array state, not React branch isolation.

The full local suite passes 1,288 tests across thirty-five files. The unchanged smoke passes 74/74. The selected Array constructor/length/isArray/push/pop/shift/unshift/splice Test262 paths pass 558/558 in both engines, with matching input hashes, compiled hashes, and verdicts. [Receipts](array-checkpoint-validation/summary.json) retain source hashes, logs, and compressed per-variant reports.

Clean relocated builds reproduce engine SHA-256 `e098a9348caa9d016baf213e6fb5f270714529440cb6a8f1ef913e802b6da2ab`. Linux at `76200a44` passes 1,288 units but fails both numeric smoke variants (72/74). Other CI jobs, E2E, and publish pass. [The failure receipt](array-checkpoint-validation/ci-failure.json) retains logs and profiles. No timeout, worker limit, or smoke selection changed.

## React relevance and remaining ownership work

React checkout `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`, `ReactFiberHooks.js`, stores memo-cache data as arrays and allocates entries with `new Array(size)`. It copies or shares those arrays according to its feature flag. This source inspection motivates array restoration; it is not a branch-isolation test of the React compiler or reconciler.

Unselected objects, array iterators, functions, jobs, modules, and Agent control metadata still need ownership policies. A selected array does not select its elements recursively. [Selected Maps and Sets](collection-checkpoints.md) now have storage checkpoints. Weak collections, promises, typed arrays, and buffers remain excluded from this API. The [React completion checklist](symbolic-react-status.md) remains open.
