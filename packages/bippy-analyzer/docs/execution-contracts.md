# Execution contracts

The interpreter predicts execution under partly known inputs. React remains responsible for mounted identity, reconciliation, and lifecycle. Fiber patterns are observations, not the execution state. This reference records the contracts implemented from the [execution-model plan](../../../docs/pr-115-implementation-plan.md).

## Values and execution

`mapValue` transforms values. It does not isolate mutations. A transform that calls application code must instead use `continueValue` or `callAlternatives` with an evaluation context.

`continueValue` preserves abrupt completion and runs the continuation only for normal alternatives. `callAlternatives` enters each alternative's guard and uses the value-fork journal. The returned value and shared writes must retain the same selecting condition.

Nullish fallback and primitive-method argument distribution use this protocol. Replacement callbacks run in match order; a thrown callback prevents subsequent callbacks only on the throwing path. Native string matching collects positions and arguments but does not execute application callbacks.

JSX resolves the factory and element type before evaluating attributes and children. Guarded continuations preserve argument order when a getter, spread, or child throws. Creating an unused element does not invoke its component.

Unresolved identifier reads retain one value per module, environment, and interpreter run. A new invocation does not turn a read of the same unresolved binding into an independent input. Resolved lexical bindings still take precedence. This does not identify unrelated opaque calls or different component occurrences with one another.

Filtering a branch during narrowing retains the original alternative indices, guards, and input declarations. The filtered branch does not get a new independent choice. This preserves the source of cached and recomputed Boolean conditions.

## Mutation and completion

The heap journal restores preexisting objects, lists, modeled states, module bindings, captured lexical bindings, and pending hook updates between sibling paths. Scope snapshots cover the current scope chain; journaled bindings cover captured scopes outside it. Locally created closures mark their captured activation scopes so those bindings survive later forks. Allocations created after a fork retain their existing path-local treatment.

Ordinary property state includes descriptor flags and getter/setter identity. A joined property-state alternative is not a JavaScript object spread: it must retain non-enumerable properties and accessors. Getter and setter calls use the original receiver and guarded continuations.

Descriptor conversion checks inherited fields and executes getters and proxy presence traps in ECMAScript field order. Bulk definitions convert every descriptor before starting definitions. Conversion failure writes no properties; a later definition failure preserves earlier committed properties.

Ordinary objects carry an integrity value alongside their entries. Both restore between siblings and join under the same selecting predicate. Freeze, seal, and prevention of extensions affect descriptor reflection, property creation, strict writes, and deletion. Integrity queries inspect current descriptors when needed: deleting or tightening a property can change whether a non-extensible object is frozen. Accessor setters remain callable on frozen objects.

Proxy presence and definition traps run as application code, not pure transforms. Ordinary-target invariant checks happen after the trap, so its earlier mutations survive a modeled rejection.

Ordinary-object enumeration snapshots candidate keys, then checks each current descriptor before reading its value. Earlier getters can delete or hide later keys; newly added keys are not visited. Integer-index keys precede other strings and symbols. Joins preserve each path’s insertion order, including deletion and reinsertion. Key-only operations do not invoke getters.

Object and JSX spreads execute getters and copy enumerable values into writable data properties. They preserve nested references and symbol keys, not source accessors. `Object.assign` differs: for supported sources and receivers, each source read immediately precedes a strict target assignment. Target setters can change later source descriptors. Throws stop later reads and sources without undoing earlier writes. String copying uses UTF-16 indices.

Internal failures restore the fork's entry state and unwind guard/journal stacks. A modeled application throw is different: mutations before it remain available to catch and finally.

Statement outcomes retain normal completion, return/throw values, loop jumps, and suspension. Mixed live/exited paths re-enter the live continuation without applying its subsequent mutations to exited paths. A mixed synchronous/suspended async call carries a settlement condition. Its synchronous paths can settle immediately; suspended paths retain their continuation and guard context. A normal finalizer preserves the pending exit, while an abrupt finalizer overrides it.

## Queued work

Each queued task has a registration identity, kind, parent task, registration cause, optional cancellation handle, and journaled pending state. Consuming a task does not remove it from a sibling path's queue. Registration and cancellation conditions participate in eligibility. Microtasks run before timers, including microtasks scheduled by other microtasks; each checkpoint is bounded by `MAX_TIMER_TASKS`.

The queue enters the task's cause through `runWithCause`. It does not add another application-mutation fork around a bound callback. Timer and promise handlers already enter guarded execution with their captured scope and hook frame. A second, frame-less fork can reintroduce absent-instance hook states and cause repeated widening. `compiled-tslib-async.js` exposed that regression.

A guard's input declarations must travel with the guard. In particular, when a task adds a constant condition inside an existing conditional execution, the resulting mutation predicate still needs the inherited input declarations.

Function invocations record the modeled task that supplied their call stack. Invoking a function from a different queued task starts a fresh stack and step budget. Resumed statement lists refresh their context too. Stale contexts entering the same queued task share its budget rather than allocating one per call, including calls from finalizers after await. Captured scopes, hooks, receivers, and guards remain available. Synchronous calls within that task still share the stack and budget; this does not raise either limit.

Pending-work diagnostics use the queue state at snapshot capture, before harness disposal. Cleanup can enqueue or cancel work, but cannot change whether the settling loop stopped with work pending.

This remains a bounded settling model, not exploration of arbitrary browser events or schedules.

## React and isolation

Hook frames own modeled application state. React drives the proxy’s mount, hide/reconnect, and unmount lifetimes. Task causes must not be replaced by whichever unrelated commit happened most recently.

Each evaluated pass stores its effect registrations. Function proxies bind each registration to a real React layout or passive effect. Dependency tokens derive from the last committed registrations, not a suspended attempt. A reused pass keeps its tokens even for effects without a dependency list, matching React’s bailout behavior.

Each native effect setup captures its own cleanup value. A suspended attempt cannot replace that cleanup, even when the component finishes evaluating before a descendant suspends. React orders sibling cleanups before setups and reconnects the committed callbacks when a hidden subtree reappears. The phase observer starts before cleanup so it does not drain cleanup-created microtasks between siblings. Class proxies retain separate committed layout/passive records.

When a component’s evaluated render throws or suspends, `runHookRender` restores its entry state and memo metadata. It discards render-phase updates from that attempt, including earlier rerender passes, without dropping incoming updates. Writes through shared objects and refs, external escape, and deferred work remain. This unwinds hook metadata; it does not roll back executed JavaScript. Completed passes also retain a discardable hook checkpoint until React accepts them. Checkpoints register with their enclosing Suspense scopes. A modeled thrown wakeable discards the affected subtree’s pending passes; entering the boundary again discards leftovers from sibling prewarming. Nested boundaries keep ancestors outside that subtree intact. Later state and reducer queue writes remain pending when the checkpoint is discarded. Reducer rebasing restores incoming actions before later actions, excluding render-phase actions from the discarded pass. Ref/object writes are still not rolled back.

Before a retry consumes external updates, its active checkpoint records their state presence and rebased reducer actions. Consuming those updates in a later pass cannot erase them on discard. A frame has one active checkpoint owner, released on commit or discard; completing an old attempt cannot release a newer owner. Heap journals and render checkpoints share the pending-update payload and capture helpers, but retain separate rollback policies.

A state update’s presence is separate from its candidate value. A joined queue cannot replace an absent update with the abandoned render’s value: on that path the next render must read its restored base state. Journals retain the selecting condition for both presence and value. Unchanged external updates remain queued without scheduling a pass, as React’s eager-bailout queue does; an unconditional update makes presence unconditional even if its value is unchanged.

Concrete modeled pending promises suspend through real wakeables without creating an independent fallback choice. Escaped or joined promise states retain conservative suspension uncertainty. This does not implement every hook: insertion effects, imperative handles, invalid cleanup values, and guarded dependency changes need further auditing.

`renderIsolatedAssignments` is an internal finite runner. It substitutes primitive imported bindings and reruns an entry or component from the beginning using a derived renderer and fresh modeled execution state. It does not pin only the final tree. It rejects an existing external provider or pinned decisions rather than combine incompatible constraints silently.

Its isolation label is `modeled-state`. Native modules and process globals are not guaranteed fresh; this is neither process isolation nor a security sandbox. It is not a public backend switch or the default rendering strategy.

## Output identity

Input IDs are normalized across completed snapshots and commit causes together. The pattern reader uses the same renaming implementation. Renaming preserves distinct inputs, references in guards and cardinalities, source metadata, and numeric ordering of counter IDs. It must not manufacture relationships between unrelated inputs.

Public renderer calls and serialized fiber-pattern shapes remain unchanged.

## Validation and remaining boundaries

`execution-contracts.test.ts` compares one combined analysis against native JavaScript for each assignment of two independent Boolean inputs. It checks values, throws, selected stores, and callback traces. The oracle rejects swapped input–outcome relationships even when the sets of values agree. Renderer differential tests separately check projection and replay; component fixtures compare against real React.

The broader implementation plan is not complete. In particular:

- Ordinary-object integrity is journaled, but arrays, functions, classes, proxies, and native targets do not have complete integrity support. Arrays still use the earlier Boolean freeze flag. Prototype changes and backing-storage aliases need further work.
- Ordinary-object enumeration preserves conditional order and descriptor checks. Proxy own-key protocols, other target families, and unsupported copy sources/receivers still have gaps.
- Hook unwinding covers evaluated throws and the tested descendant-Suspense/prewarming paths, including conditional pending updates. Non-Suspense abandonment, further interrupted queue histories, guarded dependencies, and other hook edge cases still need work.
- Repeated noncached dynamic equality and other opaque derived operations need further provenance work.
- Generator cursor journaling does not implement general generator suspension. The async changes do not support every await expression or asynchronous loop.
- Unknown/native calls do not yet have complete mutation, exception, callback-retention, and scheduling contracts.
- Combined rendering can still interfere through shared application state. Finite isolated assignments do not prove coverage of every history.

Passing these contracts or obtaining an `exact` structural report does not remove those boundaries.
