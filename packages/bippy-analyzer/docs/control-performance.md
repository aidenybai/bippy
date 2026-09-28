# Control-runtime performance

Linux CI at `69bfb3e3` passes 890 unit tests but times out on both numeric `substr` variants. The unchanged smoke result is 72/74. Failure-only profiling takes 14398.57 ms with default flags and 14943.93 ms without Maglev. Neither diagnostic result changes the gate status.

The [retained Linux profiles](control-validation/ci-smoke-failure.json) identify control dispatch, frame stepping, and generated loop helpers as costs. The maintained changes are:

- Keep ordinary host functions’ `for…of` loops native. Only generator functions need Babel’s loop lowering. Engine262 still implements guest iteration semantics.
- Store each internal completion in one record. Allocate the public iterator-result object only when returning to the caller.
- Use private frame branding before accessing owned delegate methods. Foreign iterators retain reflective dispatch without an extra prototype-chain inspection.
- Reuse an immutable compiler-helper object instead of allocating its methods on each generator invocation.

Native generator comparisons cover ordinary-loop closure capture and iterator closing, suspending generator loops, and a foreign proxy that rejects prototype inspection. Existing control restoration, rejection, and completion tests remain unchanged.

## Measurements and rejected changes

Three local runs per version use the unchanged default numeric input, SHA-256 `c10662bb40d9fc9ad0264cc67023f936466e3f403896c4afaef46b99cf24c126`. On macOS arm64/Node 26.4.0, the median changes from 4874.58 ms to 3908.49 ms. These are sequential local samples, not Linux passing evidence.

Several alternatives were rejected:

- Lowering only loops with visible control transfers in the original combined pass fails compilation. Later block-scope lowering can introduce a generator wrapper and suspension.
- Separating preparation and generator lowering compiles, but its local median is 3956.93 ms. The extra pipeline stage is not retained.
- Keeping constant activation bindings in native captures gives 3883.83 ms, within the observed timing variation. The capture-layout change is not retained.
- Sharing empty handler arrays gives 3991.31 ms. The additional handler-storage change is not retained.

## Verification and scope

The local suite passes 909 tests across 22 files. The unchanged smoke passes 74/74. The 212 generator variants and 559 parameter/arguments variants preserve their input hashes, compiled hashes, and verdicts. The parameter selection retains its two existing failures.

Typecheck, root check, and relocated clean builds pass. Engine SHA-256 is `963fd3c6767af14cffb462430fef2e7ffba2e8224453f6c32d84690a0782ce85`. [Receipts](control-performance-validation/summary.json) retain measurements, rejected attempts, and command logs.

Linux confirmation remains pending. No timeout, worker limit, or Test262 selection changed. These changes do not add a general state owner, abstract domains, or symbolic React rendering.
