<h1><img src="./.github/public/bippy.png" width="48" alt="" align="middle" /> bippy</h1>

[![version](https://img.shields.io/npm/v/bippy?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)
[![downloads](https://img.shields.io/npm/dt/bippy.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)

bippy lets you inspect React Fiber trees from outside React components. It installs a DevTools-compatible hook and normalizes common Fiber operations across React 17 through 19.

> [!WARNING]
> bippy relies on unstable React internals. A React update can break your app or any package that depends on bippy.

## Table of contents

- [How bippy works](#how-bippy-works)
- [Install bippy](#install-bippy)
  - [Next.js](#nextjs)
  - [Vite](#vite)
  - [Library setup](#library-setup)
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
- [Build a render highlighter](#build-a-render-highlighter)
- [Glossary](#glossary)
- [About bippy](#about-bippy)

## How bippy works

React renderers report lifecycle events to React DevTools through `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__`. bippy installs a compatible hook before React loads, then exposes those events and their Fiber trees through a stable API.

A Fiber is a unit in React’s internal tree. Each Fiber represents a component, host instance, or other piece of rendering work. Its `child`, `sibling`, and `return` fields connect it to the rest of the tree.

Use the [React Fiber tree visualization](https://jser.pro/ddir/rie?reactVersion=18.3.1&snippetKey=hq8jm2ylzb9u8eh468) to explore the structure. The [React re-rendering deep dive](https://jser.dev/2023-07-18-how-react-rerenders/) explains how React uses it during rendering.

## Install bippy

Install bippy and load it before React or any React renderer.

```shell
npm install bippy
```

The import order matters because React reads the DevTools hook when its bundle initializes.

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

### Library setup

Libraries that only need to install the hook can use `bippy/install-hook-only`. Import utilities from `bippy/core` to keep that entry point explicit:

```typescript
import "bippy/install-hook-only";
import { getRDTHook, traverseFiber } from "bippy/core";
import * as React from "react";
```

## React integration

The main `bippy` entry point installs the DevTools hook before resolving your project’s React version. React remains an external peer dependency and is not bundled with bippy.

### `useFiber`

Returns the calling component’s Fiber without requiring a provider. During server rendering it returns `undefined` because there is no client Fiber for the component.

```tsx
import { useFiber } from "bippy";

const Component = () => {
  const fiber = useFiber();
  console.log(fiber?.type);
  return null;
};
```

## Instrumentation

Instrumentation subscribes to renderer lifecycle events without replacing other bippy subscribers or React DevTools.

### `instrument`

Registers handlers on the React DevTools hook and returns an unsubscribe function. Call `instrument` after importing bippy and before using data from a renderer.

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

Multiple calls compose. Each unsubscribe function removes only the handlers registered by its matching call. Errors from instrumentation, React DevTools, and listeners propagate to the caller.

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

These predicates inspect one Fiber’s flags and alternate. They report whether the Fiber has rendered or committed in the past, not whether it changed in the current commit. Use `traverseRenderedFibers` when you need commit-scoped results and render phases.

```typescript
import { didFiberCommit, didFiberRender } from "bippy";

console.log(didFiberRender(fiber));
console.log(didFiberCommit(fiber));
```

## Fiber inspection

Inspection helpers identify Fibers and read their component, host instance, and renderer metadata.

### `setFiberId` and `getFiberId`

Assign and read a stable numeric identity shared by a Fiber and its alternate. `getFiberId` creates an identity when one does not exist.

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

Returns the current side of a Fiber’s double-buffered pair. Pair it with `getFiber` when the host instance may reference an older alternate.

```typescript
import { getFiber, getLatestFiber } from "bippy";

const fiber = getFiber(document.body);
const latestFiber = fiber ? getLatestFiber(fiber) : null;
```

### `getRenderer`

Returns the React renderer that owns a Fiber. The result is `null` until bippy observes the Fiber’s root through a commit.

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

Returns the source location where React created a Fiber. It uses React debug metadata and source maps across DOM, native, terminal, canvas, PDF, and custom renderers.

```typescript
import { getSource } from "bippy/source";

const source = await getSource(fiber);
console.log(source);
```

Source inspection has these constraints:

- React controls whether debug metadata exists
- Production builds normally remove source metadata
- React 18 requires `_debugSource` from the JSX source transform
- React 19 uses `_debugStack` for composite and host Fibers
- Runtimes without `fetch` receive unsymbolicated locations

Pass a `SourceFetch` implementation for packaged bundles, virtual filesystems, or renderer-specific URLs:

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

bippy discovers maps from `SourceMap` headers, source map annotations, and Metro’s `.bundle` to `.map` convention. It preserves Metro query parameters when requesting a map.

### `getOwnerStack` and `getParentStack`

Both functions return symbolicated component stacks above a Fiber. `getOwnerStack` follows the components that created the Fiber’s JSX. `getParentStack` follows every ancestor in the Fiber return chain.

```typescript
import { getOwnerStack, getParentStack } from "bippy/source";

const ownerFrames = await getOwnerStack(fiber);
const parentFrames = await getParentStack(fiber);
```

`getOwnerStack` falls back to `getParentStack` when React does not expose usable owner frames.

## Build a render highlighter

This example combines instrumentation and traversal to outline host elements when their Fibers render.

First, create a helper that finds and outlines the first host Fiber below a rendered Fiber:

```typescript
import { isHostFiber, traverseFiber, type Fiber } from "bippy";

const highlightFiber = (fiber: Fiber): void => {
  const hostFiber = traverseFiber(fiber, isHostFiber);
  if (!(hostFiber?.stateNode instanceof HTMLElement)) return;

  const bounds = hostFiber.stateNode.getBoundingClientRect();
  const outline = document.createElement("div");
  outline.style.cssText = `
    position: fixed;
    inset: ${bounds.top}px auto auto ${bounds.left}px;
    width: ${bounds.width}px;
    height: ${bounds.height}px;
    border: 1px solid red;
    pointer-events: none;
  `;
  document.documentElement.appendChild(outline);
  const animation = outline.animate([{ opacity: 1 }, { opacity: 0 }], 100);
  void animation.finished.then(() => outline.remove());
};
```

Then call the helper for each Fiber reported by `traverseRenderedFibers`:

```typescript
import { instrument, traverseRenderedFibers } from "bippy";

instrument({
  onCommitFiberRoot(_rendererID, root) {
    traverseRenderedFibers(root, (fiber) => {
      highlightFiber(fiber);
    });
  },
});
```

[`react-scan`](https://github.com/aidenybai/react-scan) applies the same idea with production safeguards, batching, and a complete overlay system.

## Glossary

Use these terms when working with React internals:

- **Fiber**: a unit in React’s internal tree that represents a component, host instance, or rendering task
- **Commit**: the phase that applies completed work to the host tree
- **Render**: the phase that builds or updates the Fiber tree
- **Host tree**: the platform-specific output that React mutates, such as DOM elements or native views
- **Renderer**: a reconciler integration such as React DOM, React Native, or React Three Fiber
- `rendererID`: the hook identifier for one renderer instance
- `root`: a `FiberRoot` whose `current` field points to the root Fiber
- `onCommitFiberRoot`: runs when React commits a Fiber root
- `onPostCommitFiberRoot`: runs after commit effects
- `onCommitFiberUnmount`: runs when React unmounts a Fiber

## About bippy

[`react-scan`](https://github.com/aidenybai/react-scan) originally motivated bippy and adds safeguards around production instrumentation. Review its source before adapting bippy for production use.

Use [`its-fine`](https://github.com/pmndrs/its-fine) when you need Fiber access through hooks inside React. Use [`react-devtools-inline`](https://www.npmjs.com/package/react-devtools-inline) when you need a complete DevTools interface.

[@dairyfreerice](https://www.instagram.com/dairyfreerice) created the original bippy character. This project has no affiliation with the Bippy brand.
