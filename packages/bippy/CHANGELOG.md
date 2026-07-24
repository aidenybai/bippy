# bippy

## 0.6.1

### patch changes

- 24b790b: preserve fiber identity when alternate fibers reuse id zero
- 8363ee2: resolve host instances from tracked roots when custom renderers do not expose `findFiberByHostInstance`, including react three fiber objects

## 0.6.0

### breaking changes

`0.6.0` intentionally narrowed bippy’s public application programming interface (api). it removed 13 exports from the policy layer and reconciliation internals:

| removed exports                                                        | migration                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `secure`, `INSTALL_ERROR`                                              | compose the required safety policies around `instrument`, as shown below  |
| `areFiberEqual`                                                        | compare the fibers and their `alternate` references                       |
| `fiberIdMap`                                                           | use `getFiberId` and `setFiberId`                                         |
| `hotSwapFiberType`                                                     | no supported replacement                                                  |
| `injectOverrideMethods`                                                | call `overrideProps`, `overrideHookState`, or `overrideContext` directly  |
| `traverseFiberAsync`, `traverseFiberSync`                              | use `traverseFiber`, which accepts synchronous and asynchronous selectors |
| `mountFiberRecursively`, `shouldFilterFiber`, `updateFiberRecursively` | call `traverseRenderedFibers` from `onCommitFiberRoot`                    |
| `unmountFiber`, `unmountFiberChildrenRecursively`                      | use the public `onCommitFiberUnmount` instrumentation callback            |

#### replace `secure` with the current public api

`secure` combined four policies with instrumentation:

- a production build gate
- a minimum react version
- an installation timeout
- callback error isolation

compose these policies around `instrument` when your integration needs them.

first, define a renderer policy that accepts react 19 or newer development renderers:

```typescript
import {
  detectReactBuildType,
  getRDTHook,
  instrument,
  isInstrumentationActive,
  traverseRenderedFibers,
  type ReactRenderer,
} from "bippy";

let canProfile = false;

const isSupportedRenderer = (renderer: ReactRenderer): boolean => {
  const reactMajorVersion = Number.parseInt(renderer.version, 10);
  const isDevelopment = detectReactBuildType(renderer) === "development";
  return reactMajorVersion >= 19 && isDevelopment;
};
```

next, guard each callback that needs error isolation:

```typescript
const guard =
  <Arguments extends unknown[]>(handler: (...arguments_: Arguments) => void) =>
  (...arguments_: Arguments): void => {
    if (!canProfile) return;
    try {
      handler(...arguments_);
    } catch (error) {
      recordError(error);
    }
  };
```

then, apply the timeout and policies when bippy becomes active:

```typescript
let didInstallTimeout = false;
const installTimeout = window.setTimeout(() => {
  if (isInstrumentationActive()) return;
  didInstallTimeout = true;
  recordError(new Error("bippy did not attach within 5s"));
  window.stop();
}, 5_000);

instrument({
  name: "react-perf",
  onActive() {
    if (didInstallTimeout) return;
    window.clearTimeout(installTimeout);
    const renderers = getRDTHook().renderers.values();
    canProfile = Array.from(renderers).every(isSupportedRenderer);
  },
  onCommitFiberRoot: guard((_rendererID, root) => {
    traverseRenderedFibers(root, onRender);
  }),
});
```

run existing `onActive` work after `canProfile` becomes `true`. omit `window.stop()` if the timeout should report an error without stopping the page load.

### minor changes

- de0c6c6: make `instrument` composable and return an unsubscribe function instead of the devtools hook
- de0c6c6: connect `onScheduleFiberRoot` and track roots without requiring an `onCommitFiberRoot` handler
- 8b0f019: make subscription cleanup functions implement `Disposable` for use with `using`
- de0c6c6: add `onRendererInject` for observing renderers loaded after instrumentation starts
- 4de5bc6: dispatch prop, hook state, and context overrides through the renderer that owns the fiber root
- 98203e3: add `bippy/react-refresh` with bundler-independent fast refresh subscriptions
- 63ebc0c: rename `onReactRefresh` to `instrumentReactRefresh`
- dc67463: accept an options object in `instrumentReactRefresh`
- 92a8d7d: split owner and parent stack traversal into `getOwnerStack` and `getParentStack`

### patch changes

- 5a767a4: cache host fiber keys and component stack frames in repeated lookups
- 5a767a4: binary search source map segments and scan bundles backward for source map trailers
- 5a767a4: avoid set allocation in `traverseProps` and repeated symbol stringification in fiber filtering

## 0.5.43

### patch changes

- republish `0.5.42` without runtime changes

## 0.5.42

### patch changes

- 1ab537c: retry source map requests after transient network and abort failures while caching definitive missing results

## 0.5.41

### patch changes

- 735fa50: keep resolved source maps strongly cached so garbage collection cannot discard them between lookups

## 0.5.40

### minor changes

- 2a450f4: support react portal fibers in traversal and host lookup
- c0e5741: add development-only `hotSwapFiberType`

### patch changes

- 094f0b7: recognize react server component frames from `rsc://` and `about://react` sources
- 131800a: recognize multi-word and hyphenated server environment names

## 0.5.39

### patch changes

- 5fda8cd: normalize `webpack-internal:///(app-pages-browser)` source paths without leaving the webpack layer prefix

## 0.5.38

### minor changes

- a9e2caa: add hook tree inspection and source-based hook name parsing to `bippy/source`

## 0.5.37

### patch changes

- update release tooling for npm passkey authentication without runtime changes

## 0.5.36

### patch changes

- 3f256f2: preserve value re-exports in generated declarations

## 0.5.35

### patch changes

- a5d41ff: inline react reconciler types to prevent downstream missing export warnings

## 0.5.34

### patch changes

- 4530c64: preserve type-only imports in generated esm and commonjs declarations

## 0.5.33

### patch changes

- 5b14026: preserve type-only imports in generated declarations and run the post-build transform with `tsx`

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

- fix: react refresh injection

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
