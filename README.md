<h1>
  <img src="./.github/public/bippy.png" width="48" alt="" valign="middle" />
  bippy
</h1>

[![version](https://img.shields.io/npm/v/bippy?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)
[![downloads](https://img.shields.io/npm/dt/bippy.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)

bippy hacks into React internals.

React keeps its internals out of reach. bippy opens them up for metaprogramming, letting you inspect the [Fiber](https://youtu.be/ZCuYPiUIONs) tree, track renders, and access the renderer directly.

> [!WARNING]
> ⚠️⚠️⚠️ **This project may break production apps and cause unexpected behavior.** ⚠️⚠️⚠️
>
> This project uses React internals, which can change at any time. We don’t recommend depending on them unless you have to. By proceeding, you acknowledge the risk of breaking your own code or apps that use your code.

## How React works internally

A Fiber is both a node in React’s internal representation of the UI and a unit of work that React can schedule. As a [UI runtime](https://overreacted.io/react-as-a-ui-runtime/), React produces and maintains a tree in a host environment such as the browser. Fiber is the data structure React uses to reconcile that UI.

React builds the Fiber tree as it renders your [component tree](https://react.dev/learn/understanding-your-ui-as-a-tree). Each Fiber is a mutable object representing a component, host element, text node, or internal boundary. It stores the node’s props, state, position in the tree, and pending work.

Consider this component tree:

```tsx
const Button = () => <button>Save</button>;

const App = () => (
  <main>
    <Button />
  </main>
);
```

Each rendered tree has a [`FiberRoot`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L212-L221) container. Its `current` field points to the `HostRoot` Fiber at the top of the tree. `HostRoot`, `FunctionComponent`, and `HostComponent` are [React’s internal work tags](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactWorkTags.js#L44-L49).

```text
FiberRoot
└── current → HostRoot Fiber
              └── App                FunctionComponent
                  └── main           HostComponent
                      └── Button     FunctionComponent
                          └── button HostComponent
```

Fibers are actual linked objects. React defines their shape in the [`Fiber` type](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L87-L174) and initializes them in [`FiberNode`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactFiber.js#L134-L173). The host Fiber for `<button>` resembles this object:

```js
FiberNode {
  tag: 5,
  type: "button",
  stateNode: HTMLButtonElement {},
  return: FiberNode { … },
  child: null,
  sibling: null,
  memoizedProps: { children: "Save" },
  flags: 0,
  alternate: null
}
```

The fields connect React’s component tree, pending work, and rendered output:

- [`tag`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L100-L101) identifies the Fiber’s internal node kind
- [`type`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L106-L114) identifies the component or host element, while `stateNode` points to its renderer-owned instance
- [`return`, `child`, and `sibling`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L122-L131) form the linked tree
- [`memoizedProps`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactInternalTypes.js#L142-L150) and `memoizedState` contain the inputs used to produce the current output
- [`flags`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactFiberFlags.js#L14-L52) records work that React must perform during the commit phase
- [`alternate`](https://github.com/facebook/react/blob/beef6d60f46a97f5c20471df81760fcf365d63ef/packages/react-reconciler/src/ReactFiber.js#L322-L351) links the current Fiber to its work-in-progress counterpart

During an update, React builds a work-in-progress tree beside the current tree. React can pause or discard this work. During the [commit phase](https://react.dev/learn/render-and-commit#step-3-react-commits-changes-to-the-dom), React applies the finished work and makes that tree current.

React does not expose Fiber as a public API. bippy “hacks into React” by accessing it anyway, giving you a consistent way to inspect Fiber trees across React versions and renderers.

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

## API Reference

### `getFiber`

Returns the Fiber associated with a renderer host instance, such as an element from the Document Object Model (DOM). The result is `null` when no registered renderer recognizes the instance.

```typescript
import { getFiber } from "bippy";

const element = document.querySelector("button");
const fiber = getFiber(element);
```

`getFiberFromHostInstance` is an alias for `getFiber`.

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

const unsubscribe = instrument({
  onCommitFiberUnmount(rendererID, fiber) {
    console.log(rendererID, fiber);
  },
});

unsubscribe();
```

Call the returned function to unsubscribe those handlers.

### `getRDTHook`

Returns the React DevTools global hook at `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__`. Use it to access registered renderers and Fiber roots directly.

```typescript
import { getRDTHook } from "bippy";

const hook = getRDTHook();
console.log(hook.renderers);
```

### `traverseRenderedFibers`

Visits Fibers that mounted, updated, or unmounted in a commit. The callback receives the Fiber and its `mount`, `update`, or `unmount` phase.

```typescript
import { instrument, traverseRenderedFibers } from "bippy";

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

const buttonFiber = traverseFiber(fiber, (candidateFiber) => {
  return isHostFiber(candidateFiber) && candidateFiber.type === "button";
});
```

The selector can also return a promise. In that case, `traverseFiber` returns a promise for the selected Fiber.

### `didFiberRender`

Returns whether a Fiber has rendered. It does not identify whether the render happened during a specific commit.

```typescript
import { didFiberRender } from "bippy";

console.log(didFiberRender(fiber));
```

Use `traverseRenderedFibers` to inspect renders from a specific commit.

### `didFiberCommit`

Returns whether a Fiber or its subtree has committed work. It does not identify a specific commit.

```typescript
import { didFiberCommit } from "bippy";

console.log(didFiberCommit(fiber));
```

### `setFiberId`

Assigns a numeric ID to a Fiber.

```typescript
import { setFiberId } from "bippy";

setFiberId(fiber, 123);
```

### `getFiberId`

Returns a stable numeric ID across Fiber updates. It creates an ID when none has been assigned.

```typescript
import { getFiberId } from "bippy";

const fiberId = getFiberId(fiber);
```

### `isFiber`

Returns whether a value contains the core fields required by a Fiber.

```typescript
import { isFiber } from "bippy";

console.log(isFiber(value));
```

### `isHostFiber`

Returns whether a Fiber represents a renderer host instance, such as a DOM element or React Native view.

```typescript
import { isHostFiber } from "bippy";

if (isHostFiber(fiber)) {
  console.log(fiber.stateNode);
}
```

### `isCompositeFiber`

Returns whether a Fiber represents a function, class, memo, or forward-ref component.

```typescript
import { isCompositeFiber } from "bippy";

console.log(isCompositeFiber(fiber));
```

### `hasMemoCache`

Returns whether a Fiber uses a React Compiler memo cache.

```typescript
import { hasMemoCache } from "bippy";

console.log(hasMemoCache(fiber));
```

### `getDisplayName`

Returns the display name of a Fiber type.

```typescript
import { getDisplayName } from "bippy";

console.log(getDisplayName(fiber.type));
```

### `getType`

Unwraps memo and forward-ref wrappers and returns the underlying component definition.

```typescript
import { getType } from "bippy";

console.log(getType(fiber.type));
```

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

The main `bippy` entry point exports the React internals used by its APIs.

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

### `getSource`

Returns the source location for a Fiber from these renderers:

- DOM
- Native
- Terminal
- Canvas
- PDF
- Custom

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

  const sourceMapUrl = artifact.sourceMapUrl;
  const headers = sourceMapUrl ? { SourceMap: sourceMapUrl } : undefined;
  return new Response(artifact.content, { headers });
};

const source = await getSource(fiber, true, sourceFetch);
```

### `getOwnerStack`

Returns the symbolicated stack of components that created a Fiber’s JSX. It falls back to the parent stack when owner information is unavailable.

```typescript
import { getOwnerStack } from "bippy/source";

const ownerFrames = await getOwnerStack(fiber);
```

### `getParentStack`

Returns the symbolicated stack of every ancestor in a Fiber’s return chain.

```typescript
import { getParentStack } from "bippy/source";

const parentFrames = await getParentStack(fiber);
```

## Acknowledgements

[@dairyfreerice](https://www.instagram.com/dairyfreerice) created and owns the original bippy character. this project has nothing to do with the bippy brand, i think the character is cute.
