---
"bippy": patch
---

Fix three 0.7.0 regressions. Instrumentation activates again when bippy loads after React under a react-refresh hook (Vite/Next dev): react-refresh's stub `inject` never records renderers, so `patchRDTHook` now detects react-refresh hooks and activates immediately, `isReactRefresh` is exported again, and `isInstrumentationActive` includes it. Commit dispatch no longer throws a TypeError on roots without a `memoizedState` nor misclassifies them as unmounting: roots stay tracked unless there is explicit unmount evidence, and `traverseRenderedFibers` tolerates an `undefined` root `memoizedState`. Importing bippy no longer crashes module evaluation when a foreign hook is frozen or otherwise rejects patching (parity with 0.6.1's guarded install). Renderers reporting legacy experimental-channel versions (`0.0.0-experimental-*`) resolve to the modern work tags instead of the React 16.0 row.
