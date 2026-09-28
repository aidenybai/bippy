# Strong collection GC roots

Engine262’s explicit collector cleared weak references to objects still held by a Map or Set. Both the published and source-built engines reproduced the bug. A surviving collection could still return an object whose weak reference had been cleared.

`collection-roots.patch` marks Map keys/values and Set elements through their internal data slots. It also retains ordinary properties, prototypes, and other marked slots. It does not call guest iterators or collection methods. WeakMap and WeakSet retain their separate weak traversal.

## Verification

`tests/gc-collections.test.ts` adds 16 checks:

- Object and symbol retention through Map keys, Map values, and Set elements.
- Nested cyclic collections with guest iteration methods that throw if called.
- Release after deletion, replacement, or clearing.
- Weak entries remain weak.
- Strongly retained entries do not schedule finalization.

Seven positive observations match independent V8 subprocesses after a task boundary and explicit GC. Negative collection checks use engine262’s explicit collector. They do not require V8 to collect unreachable targets at a particular time.

The first nested fixture accidentally retained its target through a replacement method’s closure. The corrected fixture creates replacement methods outside that closure. Eight tests then failed before the patch; all 16 pass after it. The first build also exposed a missing `ObjectValue` type guard. Both failures remain in the [validation receipts](collection-roots-validation.json).

The full local suite passes 906 tests across 22 files. Typecheck, root check, relocated reproducibility, the unchanged 74-variant smoke, and 152 WeakRef/FinalizationRegistry variants pass. Engine SHA-256 is `e5595cae5cf80ae9d9ca79dd7bf9f9f77748da83aa36f4e27cc71ed0941c6ebf`.

## Remaining scope

This fixes strong collection retention, not collection checkpoints or whole-engine ownership. It does not establish complete GC traversal, suspended-control roots, ephemeron fixpoint correctness, or symbolic React execution.

The preceding control revision still fails Linux’s unchanged smoke at 72/74 because both numeric `substr` variants time out. Its 890 unit tests pass after native module loading was corrected. This GC patch does not resolve that performance failure.
