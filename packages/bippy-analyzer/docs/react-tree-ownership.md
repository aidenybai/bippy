# React tree specialization and ownership blockers

`tests/symbolic-react-tree.test.ts` checks committed host trees from actual React/Test Renderer 19.3.0 running through engine262. It is a specialization fixture, not a shared-prefix explorer or a public symbolic tree API.

The fixture passes two opaque Boolean inputs through a context value object. Repeated decisions preserve each input’s identity. Four assignments cover correlated headings, attributes, disabled buttons, conditional children, and different child element types. Each pause forces engine GC. Native V8 execution and explicit expected trees independently check the results. Mount, update, job draining, layout cleanup, and unmount observations must match. JSON output omits callback-valued props; these tests do not verify event reports.

The context value is an object, and the effect depends on that object. This does not establish support for opaque Booleans in `Object.is`, dependency-array comparisons, or host text conversion. Each assignment starts a fresh runtime. Those runs validate specialization; they do not implement symbolic branching.

## Inspect the state before the first choice

The [diagnostic receipt](react-tree-validation/audit.json) includes the probe source, fixture source, hashes, four reports, and intermediate logs. The probe extends `captureEvaluation` reference discovery with existing engine `mark` methods and native array entries. It captures and releases individual guest objects through `createStateCheckpoint`, then throws a sentinel. It never restores React state. Execution resumes the original pending decision.

All four first-choice reports contain the same counts:

- 65,387 root references after diagnostic discovery, not unique roots.
- 19,556 distinct visited objects, including native engine metadata and values.
- 2,197 guest objects, of which 2,158 accept selected capture and 39 reject it.
- 94 declarative environments, 37 function environments, one global environment, and one object environment.
- 1,848 native arrays, 14 execution contexts, 24 call sites, and 683 native functions.

[Arguments](arguments-checkpoints.md), [intrinsic prototypes](intrinsic-checkpoints.md), [Errors](error-checkpoints.md), [RegExp](regexp-checkpoints.md), and [WeakMaps](weak-map-checkpoints.md) now have selected storage policies. The original diagnostic accepts all 2,197 guest objects. Its rejection table below is historical, not the current unsupported set.

[Expanded discovery](weak-map-checkpoints.md) follows collection entries and CallSite contexts as well. It finds 2,199 guest objects, 20 execution contexts, and 1,852 native arrays. One combined selected checkpoint captures those guest objects, 138 environments, and 814 binding cells, then releases them without restoration. Broader ownership still rejects. Native records, queues, effects, and omitted references remain unowned, so this does not permit general React branching.

The original rejected guest objects are:

| Count | Storage             | Evidence                                                                       |
| ----- | ------------------- | ------------------------------------------------------------------------------ |
| 1     | `Object.prototype`  | Its immutable-prototype `SetPrototypeOf` method differs from ordinary objects. |
| 1     | `String.prototype`  | String-exotic methods and `StringData` need a policy.                          |
| 16    | Mapped arguments    | `ParameterMap` and five arguments-exotic methods reject.                       |
| 13    | Lazy parameter maps | Custom `GetOwnProperty` and `OwnPropertyKeys` methods reject.                  |
| 3     | WeakMaps            | `WeakMapData` is unsupported.                                                  |
| 4     | Errors              | Diagnostic fields and captured stacks are unsupported.                         |
| 1     | RegExp              | Matcher, source, and flag storage are unsupported.                             |

The lazy maps are not ordinary property tables with different method names. In `arguments-operations.mts`, their methods close over `pendingMappings`, the original environment, and the realm. Reading a mapped index can install getter/setter functions, remove pending entries, and replace the methods. A correct owner must preserve those state changes and binding aliases. Copying visible properties alone cannot do so.

This diagnostic is not a complete ownership census. Marking edges omit weak-entry ownership, undeclared native captures, host state, and custom internal-method captures. Supported individual object snapshots also do not restore native arrays, context fields, queues, or referenced records. Do not infer React ownership from accepted-object counts, including the expanded diagnostic’s 2,199 objects.

## Verification and next work

The existing cloned React source at `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51` supplies the internals reference. `ReactFiberBeginWork.js:updateContextProvider` pushes the provider value before reconciliation. `ReactFiberCommitEffects.js:commitHookEffectListMount` calls the effect and stores its destroy callback. Both paths explain why context stacks and effect records must belong to the branch, not only rendered host objects.

The four specialization tests pass. The full suite passes 1,530 tests across 48 files, and typechecking passes. The engine remains unchanged at SHA-256 `653ba15d733596c6625d1415bf233b397f9fec0eac6c40ca76e84890799ed56d`. These checks do not validate shared-prefix restoration. [Linux CI](react-tree-validation/ci-failure.json) passes 1,530 units but fails both numeric `substr` smoke variants at the unchanged ten-second gate (72/74). The engine hash matches; E2E and publish pass. Diagnostic profiles remain archived and are not smoke passes.

Implement rejecting ownership policies using the existing checkpoint, native-capture, and queue machinery. Verify both branch orders with one prefix before exposing a guarded explorer. General tree merging, event/effect transitions, repeated families, and demo integration remain incomplete.
