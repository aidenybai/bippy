# Clock and random boundaries during checkpoints

Evaluation checkpoints now reject engine clock reads and random-number generation before touching unowned state. Two calls to the existing `Agent.assertCanPerformHostEffect()` provide this boundary. There is no new scheduler, random generator, clock model, or permission bypass.

## Guarded operations

`Math_random` checks before reading the Realm’s seed hook, allocating random state, or advancing an existing state buffer. A supplied deterministic seed does not make that mutable state owned. Borrowing the original intrinsic through another property or `.call` does not bypass the guard.

`HostSystemUTCEpochNanoseconds` checks before looking up a host clock hook or reading native `Date.now()`. This covers the shared clock primitive used by Date and Temporal. Tests exercise guest Date calls and the direct engine clock entry points. They do not establish full Temporal parity.

A rejection during branch execution bypasses guest `catch` and makes the evaluator terminal. Subsequent resume and restore attempts rethrow the same failure. Release remains available. A rejected owner capture registers no frame and leaves the exact pending decision usable.

Ordinary execution outside evaluation checkpoints remains unchanged. Explicit UTC date construction, parsing, and conversion work inside a checkpoint. Replacing `Date.now` or `Math.random` with ordinary guest functions does not trigger a syntax-based ban. Direct clock calls work again after checkpoint release.

## Native-record audit

The actual React diagnostic exposes more native state than the selected snapshot APIs own. Its shape inventory includes:

- 5,998 Descriptor instances and 2,212 PropertyKeyMaps.
- 814 binding records, 43 NormalCompletions, and one ReturnCompletion.
- Two ScriptRecords, one ManagedRealm, one Agent, and one ConcreteRuntime.
- Native Map, Set, WeakMap, RegExp, and typed-array objects.
- Parsed syntax records, static tables, iterator-result-shaped records, and the engine namespace.

Some records belong to already selected objects or bindings. Others may be immutable metadata or mutable state requiring a separate policy. Counts and property names do not establish either classification. In particular, the Realm exposes `randomState`; selected native arrays do not restore that typed-array state or authorize entropy use.

The inventory uses existing capture and marking traversal, not a new production heap scanner. It is incomplete and diagnostic. Source paths, the driver, record shapes, and reports are retained in the [validation receipts](checkpoint-nondeterminism-validation/summary.json).

## Validation

The exact predecessor fails 17 of the 19 final cases; two ordinary-execution controls pass. All 19 pass with the guard. Tests cover cold, seeded, and advanced random state, hook lookup, borrowed intrinsics, guest catch bypass, terminal failures, capture/restore phases, release, and allowed explicit conversions. One conversion/replacement result is independently checked against Node. Seeded execution is compared across two fresh engine realms, not against V8’s different random generator.

All 1,850 units across 64 files, types, relocated builds, and the unchanged local 74-variant smoke pass. New source and published Math.random, Date, and Temporal.Now.instant selections both pass 196 variants. Input and compiled hashes match. Other recorded conformance failures remain unresolved.

The unchanged React diagnostic still reaches its first user timer. An initial expectation that it would instead read the clock failed and is preserved. The corrected diagnostic explicitly calls application `Date.now()` after `fixture.update`. The same driver reaches the timer on the predecessor and rejects at the clock on the maintained engine. Both orders execute one prefix and produce no branch observations. This does not prove that React’s paused suffix itself reads time, nor does it provide clock or random rollback.

Initial type errors in the test’s captured decision and seed-hook return were corrected before the exact final predecessor run. General React ownership, guarded reports, transitions, repeated-state families, and the symbolic demo remain incomplete.
