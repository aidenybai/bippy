<h1>
  <img src="./.github/public/bippy.png" width="48" alt="" valign="middle" />
  bippy
</h1>

[![version](https://img.shields.io/npm/v/bippy?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)
[![downloads](https://img.shields.io/npm/dt/bippy.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)

bippy hacks into React internals.

React normally keeps its Fiber tree out of reach. bippy gets you in, so you can inspect components, track renders, and access the renderer directly.

> [!WARNING]
> ⚠️⚠️⚠️ **This project may break production apps and cause unexpected behavior.** ⚠️⚠️⚠️
>
> This project uses React internals, which can change at any time. We don't recommend depending on internals unless you really, _really_ have to. By proceeding, you acknowledge the risk of breaking your own code or apps that use your code.

## Table of contents

- [Install bippy](#install-bippy)
  - [Next.js](#nextjs)
  - [Vite](#vite)
- [React integration](#react-integration)
  - [`useFiber`](#usefiber)
- [Instrumentation](#instrumentation)
  - [`instrument`](#instrument)
  - [`getRDTHook`](#getrdthook)
- [Fiber traversal](#fiber-traversal)
  - [`traverseRenderedFibers`](#traverserenderedfibers)
  - [`traverseFiber`](#traversefiber)
  - [`didFiberRender` and `didFiberCommit`](#didfiberrender-and-didfibercommit)
- [Fiber inspection](#fiber-inspection)
  - [`setFiberId` and `getFiberId`](#setfiberid-and-getfiberid)
  - [Classification helpers](#classification-helpers)
  - [`getDisplayName` and `getType`](#getdisplayname-and-gettype)
  - [`getFiber`](#getfiber)
  - [`getLatestFiber`](#getlatestfiber)
  - [`getRenderer`](#getrenderer)
  - [React internals](#react-internals)
- [Source inspection](#source-inspection)
  - [`getSource`](#getsource)
  - [`getOwnerStack` and `getParentStack`](#getownerstack-and-getparentstack)
- [Acknowledgements](#acknowledgements)

## Install bippy

Install bippy:

```shell
npm install bippy
```

Import bippy before React or any React renderer.

### Next.js

Next.js 15.3 and later can load bippy through [`instrumentation-client.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client). Create the file at the project root or in `src`:

```typescript
import "bippy";
```

### Vite

Import bippy at the top of your Vite entry point, before any React imports:

```typescript
import "bippy";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
```

## React integration

### `useFiber`

Returns the calling component’s Fiber. During server rendering it returns `undefined` because there is no client Fiber for the component.

```tsx
import { useFiber } from "bippy";

const Component = () => {
  const fiber = useFiber();
  console.log(fiber?.type);
  return null;
};
```

## Instrumentation

Listen for React lifecycle events with `instrument`.

### `instrument`

Registers lifecycle handlers and returns an unsubscribe function.

Available handlers include:

- `onActive`: runs when instrumentation becomes active
- `onScheduleFiberRoot`: runs when React schedules a root
- `onCommitFiberRoot`: runs when React commits a root
- `onPostCommitFiberRoot`: runs after commit effects
- `onCommitFiberUnmount`: runs when React unmounts a Fiber

```typescript
import { instrument } from "bippy";
import * as React from "react";

const unsubscribe = instrument({
  onCommitFiberRoot(rendererID, root) {
    console.log(rendererID, root.current);
  },
});

unsubscribe();
```

Call the returned function to unsubscribe those handlers.

### `getRDTHook`

Returns `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__`. Use it when an integration needs the complete renderer registry or another low-level hook capability.

```typescript
import { getRDTHook } from "bippy";

const hook = getRDTHook();
console.log(hook.renderers);
```

## Fiber traversal

Traversal helpers walk a complete Fiber tree or select the Fibers involved in a commit.

### `traverseRenderedFibers`

Visits Fibers that mounted, updated, or unmounted in a commit. The callback receives the Fiber and its `mount`, `update`, or `unmount` phase.

```typescript
import { instrument, traverseRenderedFibers } from "bippy";
import * as React from "react";

instrument({
  onCommitFiberRoot(rendererID, root) {
    traverseRenderedFibers(root, (fiber, phase) => {
      console.log(rendererID, phase, fiber);
    });
  },
});
```

Call it with the same root across commits so bippy can compare the current and previous trees.

### `traverseFiber`

Walks down from a Fiber and calls a selector for each node. Return `true` to stop and return the selected Fiber. Pass `true` as the third argument to walk toward the root instead.

```typescript
import { isHostFiber, traverseFiber } from "bippy";

const buttonFiber = traverseFiber(root.current, (fiber) => {
  return isHostFiber(fiber) && fiber.type === "button";
});
```

The selector can also return a promise. In that case, `traverseFiber` returns a promise for the selected Fiber.

### `didFiberRender` and `didFiberCommit`

Return whether a Fiber has rendered or committed. Use `traverseRenderedFibers` to inspect changes from a specific commit.

```typescript
import { didFiberCommit, didFiberRender } from "bippy";

console.log(didFiberRender(fiber));
console.log(didFiberCommit(fiber));
```

## Fiber inspection

Inspection helpers identify Fibers and read their component, host instance, and renderer metadata.

### `setFiberId` and `getFiberId`

Assign and read a stable numeric identity across Fiber updates. `getFiberId` creates an identity when one does not exist.

```typescript
import { getFiberId, setFiberId } from "bippy";

setFiberId(fiber, 123);
console.log(getFiberId(fiber));
```

### Classification helpers

Use these predicates to narrow an unknown value or Fiber before reading renderer-specific fields:

| Helper             | Result                                                  |
| ------------------ | ------------------------------------------------------- |
| `isFiber`          | Performs a fast check for a Fiber-like object           |
| `isValidFiber`     | Checks the core fields required by a Fiber              |
| `isHostFiber`      | Narrows a Fiber to a host Fiber                         |
| `isCompositeFiber` | Finds function, class, memo, and other composite Fibers |
| `hasMemoCache`     | Detects React Compiler memo cache data                  |

```typescript
import { isHostFiber } from "bippy";

if (isHostFiber(fiber)) {
  console.log(fiber.stateNode);
}
```

### `getDisplayName` and `getType`

`getDisplayName` reads a component name from a Fiber type. `getType` unwraps memo and forward-ref wrappers to return the underlying component definition.

```typescript
import { getDisplayName, getType } from "bippy";

console.log(getDisplayName(fiber.type));
console.log(getType(fiber.type));
```

### `getFiber`

Returns the Fiber associated with a renderer host instance, such as a DOM element. The result is `null` when no registered renderer recognizes the instance.

```typescript
import { getFiber } from "bippy";

const element = document.querySelector("button");
const fiber = getFiber(element);
```

`getFiberFromHostInstance` remains available as an alias.

### `getLatestFiber`

Returns the latest version of a Fiber. Use it when you retain a Fiber across renders.

```typescript
import { getFiber, getLatestFiber } from "bippy";

const fiber = getFiber(document.body);
const latestFiber = fiber ? getLatestFiber(fiber) : null;
```

### `getRenderer`

Returns the React renderer that owns a Fiber, or `null` when the renderer is unavailable.

```typescript
import { getRenderer } from "bippy";

const renderer = getRenderer(fiber);
renderer?.overrideProps?.(fiber, ["title"], "new title");
renderer?.scheduleUpdate?.(fiber);
```

Renderer capabilities are optional and vary by renderer version.

### React internals

The main `bippy` entry point exports the complete internals model used by its APIs. This includes Fiber, root, renderer, dispatcher, work-tag, flag, symbol, and build-type definitions.

```typescript
import {
  MutationMask,
  ReactBuildType,
  ReactFiberFlags,
  ReactSymbols,
  getReactWorkTags,
  getReactWorkTagsForFiber,
  getReactWorkTagsForRenderer,
} from "bippy";
import type {
  Fiber,
  FiberRoot,
  ReactDevToolsGlobalHook,
  ReactRenderer,
  RendererDispatcherRef,
} from "bippy";
```

These definitions follow React’s private implementation and may change between React versions.

## Source inspection

Source utilities resolve component locations, source maps, and component stacks. Import them from `bippy/source`.

### `getSource`

Returns the source location for a Fiber across DOM, native, terminal, canvas, PDF, and custom renderers.

```typescript
import { getSource } from "bippy/source";

const source = await getSource(fiber);
console.log(source);
```

Production builds may omit source information. Runtimes without `fetch` receive unsymbolicated locations.

Pass a custom `SourceFetch` for packaged bundles, virtual filesystems, or renderer-specific URLs:

```typescript
import { getSource, type SourceFetch } from "bippy/source";

const sourceFetch: SourceFetch = async (url, init) => {
  const artifact = sourceArtifacts.get(url);
  if (!artifact) return fetch(url, init);

  return new Response(artifact.content, {
    headers: artifact.sourceMapUrl ? { SourceMap: artifact.sourceMapUrl } : undefined,
  });
};

const source = await getSource(fiber, true, sourceFetch);
```

### `getOwnerStack` and `getParentStack`

Both functions return symbolicated component stacks above a Fiber. `getOwnerStack` follows the components that created the Fiber’s JSX. `getParentStack` follows every ancestor in the Fiber return chain.

```typescript
import { getOwnerStack, getParentStack } from "bippy/source";

const ownerFrames = await getOwnerStack(fiber);
const parentFrames = await getParentStack(fiber);
```

## Acknowledgements

the original bippy character is owned and created by [@dairyfreerice](https://www.instagram.com/dairyfreerice). this project is not related to the bippy brand, i just think the character is cute.
