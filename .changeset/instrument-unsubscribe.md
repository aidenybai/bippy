---
"bippy": minor
---

feat!: `instrument` now returns an unsubscribe function instead of the DevTools hook (use `getRDTHook()` if you need the hook object). Each hook event is patched once and dispatches to a listener set, so multiple `instrument` calls compose instead of replacing earlier handlers, and unsubscribing removes exactly the handlers that call registered. The previously dead `onScheduleFiberRoot` option is now wired up, and `_fiberRoots` tracking no longer requires an `onCommitFiberRoot` handler. `overrideProps`/`overrideHookState`/`overrideContext` and `onReactRefresh` now observe late-injected renderers through a shared single inject wrapper (new `onRendererInject` export) instead of stacking their own patches. Every subscription API (`instrument`, `onReactRefresh`, `onRendererInject`) returns an `Unsubscribe` that is also a `Disposable`, so subscriptions compose through `using`.
