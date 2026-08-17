---
"bippy": patch
---

Fix two 0.7.0 regressions. Instrumentation activates again when bippy loads after React under a react-refresh hook (Vite/Next dev): react-refresh's stub `inject` never records renderers, so `patchRDTHook` now detects react-refresh hooks and activates immediately, `isReactRefresh` is exported again, and `isInstrumentationActive` includes it. Commit dispatch no longer throws a TypeError on roots without a `memoizedState` (and no longer misclassifies them as unmounting): root mount tracking now follows DevTools' `root.current.child` check with `memoizedState.element` as a fallback, and `traverseRenderedFibers` tolerates an `undefined` root `memoizedState`.
