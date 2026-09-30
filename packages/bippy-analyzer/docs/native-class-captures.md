# Native class lexical captures

The capture transform now registers lexical bindings for named class declarations and supported class expressions. This fixes a continuation-restoration gap when a class is the only reference to a mutable native binding.

A regression creates a class inside a completed native factory. Only its static method reads and updates the factory’s counter. The predecessor restores the continuation but leaves the counter changed by the first branch. Class metadata lets the existing `captureControl` binding mechanism restore that counter. Both branch orders match fresh native executions, with one factory invocation per order.

## Registration and boundaries

Named declarations register after class evaluation, not before their temporal dead zone. Class expressions use the existing name-preservation mechanism shared with functions. Registration keeps the original constructor and does not invoke it or inspect properties through getters.

Each class manifest reports `[[ClassState]]` as unowned. Private names also report `[[PrivateEnvironment]]`. Lexical binding restoration does not restore:

- Static or instance fields.
- Prototype and superclass state.
- Private fields or methods.
- Captures reached only through a detached method.

A rejecting owner can refuse `[[ClassState]]` before branch execution. The lexical-counter regression accepts its unchanged class storage only for that fixture. It is not a general class owner.

Classes that escape during static initialization have no registration until evaluation completes. Computed property-name inference and anonymous default class declarations remain unsupported. Arbitrary foreign classes, callable constructor wrappers, and methods do not acquire metadata from this change. Class manifests conservatively include referenced outer bindings, not an exact proof of all retained state.

## Validation

The final 13 cases pass. The exact predecessor fails 10 cases and passes three controls. Tests cover counter restoration, identity, names, heritage, construction, freezing, private names, shadows, early escape, and explicit ownership rejection. Six native observations independently check branch results and class evaluation behavior.

An initial test expected a captured getter to throw before a later `const` initialization. Through the full lowering pipeline, it returned `undefined`. That pipeline’s block-scoping transform does not preserve this temporal-dead-zone behavior. The final test isolates the metadata transform and verifies its lazy getter and class registration behavior. This is narrower evidence, not a fix to the full pipeline. The initial failure remains in the [receipts](native-class-capture-validation/summary.json).

All 2,000 units across 72 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. New source conformance passes 623 variants. These match reused published weak-reference results and a fresh 20-case `Reflect.construct` selection by input hashes, compiled hashes, and verdicts.

## Actual React diagnostic

This transform instruments native engine implementation classes, not guest application classes. React’s `constructClassInstance` invokes the component constructor, reads `instance.state`, and assigns its updater and fiber association. Those instance mutations still need ownership. Inspecting that React source does not establish native or guest class rollback.

The same partial-owner diagnostic ran on predecessor and maintained engines in both orders. Discovery changes from 2,478 native functions with 2,419 registered to 2,749 with 2,734 registered. Fifteen functions remain unregistered in that diagnostic, including callable value/completion/descriptor wrappers and foreign callbacks. The later [callable-capture increment](callable-captures.md) follows those wrappers’ original references and exposes further native dependencies. It does not own their storage.

Guest object count stays at 2,199. Both orders execute one prefix and reject the first branch timer without a tree observation. The diagnostic deliberately ignores the new class-state warning while testing the existing host-effect guard. Its counts and accepted records do not establish transitive ownership. No effect permission, guarded tree, transition report, or repeated-state family is added.
