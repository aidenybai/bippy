# bippy

## 0.7.3

### Patch Changes

- e113600: Add target-aware instrumentation, stable reverse Fiber ID lookup, React 16 compatibility, standalone hook inspection, DevTools root tracking, and columnless and inline-require source-map hook-name parsing.
- b756bd6: Align hook inspection and component stacks with current React internals. Hook trees now preserve async debug information, support recoverable `use` values, and resolve function-component default props. Server frames use React's current environment format and debug locations, and non-production renderer bundle types are detected consistently with React DevTools.

## 0.7.2

### Patch Changes

- 742a3b5: Comprehensive Fast Refresh e2e coverage: ported React suite, real HMR, build and version matrices

## 0.7.1

### Patch Changes

- 07e6032: Fix three 0.7.0 regressions. Instrumentation activates again when bippy loads after React under a react-refresh hook (Vite/Next dev): react-refresh's stub `inject` never records renderers, so `patchRDTHook` now detects react-refresh hooks and activates immediately, `isReactRefresh` is exported again, and `isInstrumentationActive` includes it. Commit dispatch no longer throws a TypeError on roots without a `memoizedState` nor misclassifies them as unmounting: roots stay tracked unless there is explicit unmount evidence, and `traverseRenderedFibers` tolerates an `undefined` root `memoizedState`. Importing bippy no longer crashes module evaluation when a foreign hook is frozen or otherwise rejects patching (parity with 0.6.1's guarded install). Renderers reporting legacy experimental-channel versions (`0.0.0-experimental-*`) resolve to the modern work tags instead of the React 16.0 row. `describeNativeComponentFrame` no longer walks deeper into React internals when the component's own frame has no file name (eval'd components); it falls back to the synthetic display-name frame instead.

## 0.7.0

### Minor Changes

- 03b829a: Clarify React internals defaults and propagate callback and DCE failures without wrapping them.
- 3702582: Report an unmount of the last committed fiber when a root loses its current instance (previously this path always threw a TypeError). Second-pass cleanup: shared renderer-dispatcher helpers, shared `getSourceContentFromSourceMap` (adds index-map support to `getDisplayNameFromSource`), and removal of dead options, types, and policy-heavy helpers (`ParseOptions.slice`, `Effect`, `FiberUpdateQueue.lastEffect`/`dispatch`, `getTimings`, `getFiberStack`, `getMutatedHostFibers`, `getNearestHostFiber`, `getNearestHostFibers`, `traverseProps`, `traverseState`, `traverseContexts`, `overrideProps`, `overrideHookState`, `overrideContext`, and `isValidFiber`). Add `getRenderer` for direct access to a fiber's renderer capabilities. Add a providerless `useFiber` hook to the main `bippy` entry point. Add `getFiber` as the concise alias for `getFiberFromHostInstance`. Export React’s internal Fiber, root, renderer, dispatcher, work-tag, flag, symbol, and build-type definitions from the main entry point.
- a3b3942: Remove dead code and deduplicate shared logic. Fix `getDisplayNameFromSource` mapping already-symbolicated frames through the source map twice, and extract the declaration closest to the mapped line so adjacent components no longer shadow the right name. Removes unused public types (`StackFrame.args`, `ParseOptions.allowEmpty`, `RenderHandler`'s state parameter, and react-reconciler type re-exports nothing consumes — import those from `react-reconciler` directly).

### Patch Changes

- 017d2d0: Support source map resolution across browser extensions and React Native Metro bundles.
- b88fcb4: Harden React internals, Fiber instrumentation, and source-map handling.

## 0.6.1

### Patch Changes

- 24b790b: Preserve Fiber identity when alternate Fibers reuse ID zero.

## 0.6.0

### Minor Changes

- de0c6c6: feat!: `instrument` now returns an unsubscribe function instead of the DevTools hook (use `getRDTHook()` if you need the hook object). Each hook event is patched once and dispatches to a listener set, so multiple `instrument` calls compose instead of replacing earlier handlers, and unsubscribing removes exactly the handlers that call registered. The previously dead `onScheduleFiberRoot` option is now wired up, and `_fiberRoots` tracking no longer requires an `onCommitFiberRoot` handler. `overrideProps`/`overrideHookState`/`overrideContext` observe late-injected renderers through a shared single inject wrapper (new `onRendererInject` export) instead of stacking their own patches. Every subscription API (`instrument`, `onRendererInject`) returns an `Unsubscribe` that is also a `Disposable`, so subscriptions compose through `using`. `overrideProps`/`overrideHookState`/`overrideContext` no longer chain per-renderer closures: writes dispatch to the renderer that owns the fiber's root when known (falling back to every captured renderer), the canonical renderer `overrideHookState` is preferred over the hook queue dispatch regardless of renderer count, and the dispatch fallback only applies to whole-value writes so partial path writes can no longer clobber an entire hook state.

### Patch Changes

- 5a767a4: perf: cache the React fiber property key in getFiberFromHostInstance so repeated lookups are a single property read instead of a for-in over every inherited DOM accessor
- 5a767a4: perf: cache component stack frames per component type in describeNativeComponentFrame, binary-search source map line segments, walk bundle lines backwards when locating the sourceMappingURL trailer, avoid Set allocation in traverseProps, and compare symbol descriptions instead of stringifying symbols in shouldFilterFiber

## 0.5.41

### Patch Changes

- fix GC

## 0.5.40

### Patch Changes

- fix

## 0.5.39

### Patch Changes

- bug fixes

## 0.5.38

### Patch Changes

- add hooks parsing

## 0.5.37

### Patch Changes

- fix

## 0.5.36

### Patch Changes

- fix

## 0.5.35

### Patch Changes

- fix

## 0.5.34

### Patch Changes

- fix: types

## 0.5.33

### Patch Changes

- fix type generation

## 0.5.32

### Patch Changes

- fix: malformed build

## 0.5.31

### Patch Changes

- fix: app-pages-browser edge case

## 0.5.30

### Patch Changes

- fix: builds

## 0.5.29

### Patch Changes

- fix: recursive failure

## 0.5.28

### Patch Changes

- fix: handle fetch errors

## 0.5.27

### Patch Changes

- fix: parse stack accidently stripping parens for next.js paths

## 0.5.26

### Patch Changes

- fix: localhost for vite links

## 0.5.25

### Patch Changes

- fix: duplication

## 0.5.24

### Patch Changes

- fix: method name

## 0.5.23

### Patch Changes

- fix: source

## 0.5.22

### Patch Changes

- fix: stripping again

## 0.5.21

### Patch Changes

- fix: app-pages-internal

## 0.5.20

### Patch Changes

- fix: MaybeFiberSource type

## 0.5.19

### Patch Changes

- fix: allow server components

## 0.5.18

### Patch Changes

- fix: webpack protocol

## 0.5.17

### Patch Changes

- fix: pages router prefix

## 0.5.16

### Patch Changes

- fix: traverseFiber behavior

## 0.5.15

### Patch Changes

- fix: getSource output

## 0.5.14

### Patch Changes

- fix: functionName on FiberSource

## 0.5.13

### Patch Changes

- fix: getSourceFromStack

## 0.5.12

### Patch Changes

- fix: getSourceFromStack

## 0.5.11

### Patch Changes

- feat: getNearestValidSource

## 0.5.10

### Patch Changes

- fix: isStandardSourceMap type

## 0.5.9

### Patch Changes

- fix: sourcemap types

## 0.5.8

### Patch Changes

## 0.5.7

### Patch Changes

- fix: custom iife

## 0.5.6

### Patch Changes

- feat: install hook iife

## 0.5.5

### Patch Changes

- fix: remove useless utils

## 0.5.4

### Patch Changes

- fix: query strings in file names

## 0.5.3

### Patch Changes

- feat: add utils for bippy/source

## 0.5.2

### Patch Changes

- fix: new source stack

## 0.5.1

### Patch Changes

- fix: rename lite to install-hook-only

## 0.5.0

### Minor Changes

- fix: overhaul source, introduce /lite

## 0.4.0

### Minor Changes

- feat: new sources subpackage, cleanups

## 0.3.34

### Patch Changes

- 479464

## 0.3.33

### Patch Changes

- fix: compat with react devtools

## 0.3.32

### Patch Changes

- fix: source maps

## 0.3.31

### Patch Changes

- fix: source

## 0.3.30

### Patch Changes

- fix: source

## 0.3.29

### Patch Changes

- fix: file resolution

## 0.3.28

### Patch Changes

- feat: parseStackFrame now returns multiple sources

## 0.3.27

### Patch Changes

- feat: fold in override

## 0.3.26

### Patch Changes

- fix: getOwnerStack has host fibers

## 0.3.25

### Patch Changes

- feat: getOwnerStack & getFiberStackTrace

## 0.3.24

### Patch Changes

- fix: improve getFiberSource accuracy

## 0.3.23

### Patch Changes

- fix: async traverseFiber

## 0.3.22

### Patch Changes

- fix: renderer types

## 0.3.21

### Patch Changes

- fix: reactContainer (again)

## 0.3.20

### Patch Changes

- fix: react container for getFiberFromHostInstance

## 0.3.19

### Patch Changes

- fix: getFiberFromHostInstance for containers

## 0.3.18

### Patch Changes

- fixes minor issues with mounting alongside devtools

## 0.3.17

### Patch Changes

- Add override methods

## 0.3.16

### Patch Changes

- rename \_source to data-react-source

## 0.3.15

### Patch Changes

- fix \_source

## 0.3.14

### Patch Changes

- tsdown

## 0.3.13

### Patch Changes

- remove file protocol

## 0.3.12

### Patch Changes

- fix: getFiberSource on next.js

## 0.3.11

### Patch Changes

- remove react bundle from bippy/source

## 0.3.10

### Patch Changes

- upgrade getFiberSource

## 0.3.9

### Patch Changes

- fix getLatestFiber bug

## 0.3.7

### Patch Changes

- fix inspect mounting

## 0.3.6

### Patch Changes

- fix side effects

## 0.3.5

### Patch Changes

- fix instrument

## 0.3.4

### Patch Changes

- fix inspect

## 0.3.3

### Patch Changes

- remove log in inspect

## 0.3.2

### Patch Changes

- fix #27

## 0.3.1

### Patch Changes

- fix source

## 0.3.0

### Minor Changes

- adds getFiberSource for bippy/source

## 0.2.24

### Patch Changes

- fix devtools fail

## 0.2.23

### Patch Changes

- fix onActive listeners

## 0.2.22

### Patch Changes

- Fix readme (again 2)

## 0.2.21

### Patch Changes

- ebfdac3: Fix README (again)
- 1dcefaa: Fix README

## 0.2.20

### Patch Changes

- 5af368d: Add tests
