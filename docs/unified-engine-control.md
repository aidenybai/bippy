# The symbolic control gate

**Status: acceptance contract and implementation direction, not implemented support.** The source fork currently executes concrete values. Running React inside it did not make its continuations forkable.

## A test that concrete enumeration cannot satisfy

The caller declares `enabled` and `fail` as unknown Booleans and `amount` as an unknown JavaScript number. It also declares unused inputs. Those declarations—not the annotations below—establish the domains.

This is an illustrative application program. `schedule` registers an engine-owned job:

```ts
export const run = (
  enabled: boolean,
  fail: boolean,
  amount: number,
  schedule: (callback: () => number) => void,
) => {
  const shared = { count: amount };
  const alias = shared;
  if (enabled) shared.count = shared.count + 1;
  schedule(() => alias.count);
  try {
    if (fail) throw shared.count;
    return { count: shared.count, sameObject: alias === shared };
  } finally {
    shared.count = shared.count + 10;
  }
};
```

Required associations:

| Condition           | Completion                                       | Callback result     |
| ------------------- | ------------------------------------------------ | ------------------- |
| `!enabled && !fail` | return `{ count: amount, sameObject: true }`     | `amount + 10`       |
| `enabled && !fail`  | return `{ count: amount + 1, sameObject: true }` | `(amount + 1) + 10` |
| `!enabled && fail`  | throw `amount`                                   | `amount + 10`       |
| `enabled && fail`   | throw `amount + 1`                               | `(amount + 1) + 10` |

`amount` must remain abstract in the result, heap, and job. Supplying a handful of numbers and observing four Boolean assignments does not pass. Do not reassociate floating-point addition: `(amount + 1) + 10` is not generally equivalent to `amount + 11`.

Unused inputs must not multiply paths. Repeated conditions must reuse input identity. Instrumentation must show that forking resumes at the decision rather than executing the effectful prefix again. Budget exhaustion must leave an incomplete result, not discard an alternative.

The next test renders those states through engine-owned React. Jobs, hook queues, suspended attempts, and cleanup must retain the same guards. A native replay may check a supplied witness; it cannot certify all satisfying inputs.

## What the concrete driver now owns

Upstream `evaluator.mts` delegates through nested host generators. The fork now lowers those generators into `src/execution-machine.ts`: program counters, activation-local records, completion handlers, and an explicit delegation stack. The existing `Agent` and `skipDebugger` iterator protocol drives that machine.

Investigation found two tail-call problems: upstream `IsInTailPosition` always returned false, and popping an engine context would not remove host continuations anyway. The fork now recognizes strict tail positions and replaces their owning call continuations, including bound/proxy calls and the call/apply intrinsics. Constructors retain their result checks. Tests compare completion/effect order with native execution and measure bounded active-frame depth.

A low-level `captureControl(iterator, owner)` can now restore control without replaying the prefix. Lazy compiler metadata exposes direct lexical captures; saved state includes mutable parameters, creator frames, delegation, and pending completions. Twenty-six tests cover this contract, including native completion witnesses and an engine262 constant-expression continuation.

This is not a general state fork. The mandatory, trusted owner must capture mutable heap/context/job state and transitive native-closure state, or reject it. Roots include direct captures and ambient names, not a complete closure graph. Tests use narrowly declared owners; the fixture that restores an object and callback array is not an engine job-queue implementation. Restoring an older state also does not make previously returned objects or escaped callbacks independent branch snapshots. Failed restoration poisons captured continuations and requires abandoning the affected analysis.

Heap objects, environments, contexts, and jobs remain mutable and unversioned in general. No built-in owner can yet checkpoint a complete application realm safely.

Changing `ToBoolean` to choose a supplied assignment would still be replay. Adding a value with an `Abstract` tag would also be insufficient: comparison, coercion, property access, intrinsic operations, and host boundaries must not treat it as a normal object or a concrete Boolean singleton.

## Implementation direction

Keep engine262's JavaScript algorithms as the semantic source. Reify their execution rather than add a second application-language interpreter:

1. Lower resumable algorithm execution into explicit frames containing a program counter, locals, caller, and completion target. Preserve abrupt completion handling introduced by upstream's macro transform. Plain host closures that outlive an operation also need explicit captured cells.
2. Drive delegation, return, throw, suspension, and tail calls through an explicit control stack. A tail call must replace the owning call frame, not merely pop an engine context. Concrete execution must pass the existing baseline before forks are enabled.
3. Give environments, object descriptors, private fields, internal collections, and job records versioned ownership. Copying only `ObjectValue.properties` misses mutable state and native closures. Every reachable write needs either branch-owned storage or a journaled operation.
4. Add abstract primitives and guarded decisions at audited semantic boundaries. Unsupported coercions, keys, intrinsics, and foreign calls must fail visibly; no ordinary truthy-object fallback.
5. Fork the explicit continuation and state root at an unresolved decision. Join only when values, aliases, completions, and pending work remain associated with their guards.

The generator-to-state-machine compiler is implemented and passes the focused concrete baseline. It is not a validated symbolic solution. The build must still expose transitive native-closure cells, and an engine state owner must preserve branch-owned heaps, contexts, and suspended jobs before this gate can pass. Copying frame records while retaining shared mutable native captures would be unsound.

Until then, the current interpreter remains the default symbolic backend. The production `StaticRenderer` now has an explicit engine execution path running application code, React DOM, and snapshot capture in the maintained engine. It rejects unknown inputs and legacy-only contracts without replay or fallback. This integration is no longer confined to experiments, but it is not a completed symbolic replacement; see the [integration contract](../packages/bippy-analyzer/src/engine/readme.md).
