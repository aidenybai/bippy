> [!WARNING]
> ⚠️⚠️⚠️ **this project may break production apps and cause unexpected behavior** ⚠️⚠️⚠️
>
> this project uses react internals, which can change at any time. it is not recommended to depend on internals unless you really, _really_ have to. by proceeding, you acknowledge the risk of breaking your own code or apps that use your code.

# <img src="https://github.com/aidenybai/bippy/blob/main/.github/public/bippy.png?raw=true" width="60" align="center" /> bippy

[![size](https://img.shields.io/bundlephobia/minzip/bippy?label=gzip&style=flat&colorA=000000&colorB=000000)](https://bundlephobia.com/package/bippy)
[![version](https://img.shields.io/npm/v/bippy?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)
[![downloads](https://img.shields.io/npm/dt/bippy.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/bippy)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/aidenybai/bippy)

bippy is a toolkit to **hack into react internals**

by default, you cannot access react internals. bippy bypasses this by "pretending" to be react devtools, giving you access to the fiber tree and other internals.

- works outside of react – no react code modification needed
- utility functions that work across modern react (v17-19)
- no prior react source code knowledge required

```jsx
import { onCommitFiberRoot, traverseFiber } from 'bippy'; // must be imported BEFORE react

instrument({
  onCommitFiberRoot: (root) => {
    traverseFiber(root.current, (fiber) => {
      // prints every fiber in the current React tree
      console.log('fiber:', fiber);
    });
  },
});
```

## how it works & motivation

bippy allows you to **access** and **use** react fibers **outside** of react components.

a react fiber is a "unit of execution." this means react will do something based on the data in a fiber. each fiber either represents a composite (function/class component) or a host (dom element).

> here is a [live visualization](https://jser.pro/ddir/rie?reactVersion=18.3.1&snippetKey=hq8jm2ylzb9u8eh468) of what the fiber tree looks like, and here is a [deep dive article](https://jser.dev/2023-07-18-how-react-rerenders/).

fibers are useful because they contain information about the react app (component props, state, contexts, etc.). a simplified version of a fiber looks roughly like this:

```typescript
interface Fiber {
  // component type (function/class)
  type: any;

  child: Fiber | null;
  sibling: Fiber | null;

  // stateNode is the host fiber (e.g. DOM element)
  stateNode: Node | null;

  // parent fiber
  return: Fiber | null;

  // the previous or current version of the fiber
  alternate: Fiber | null;

  // saved props input
  memoizedProps: any;

  // state (useState, useReducer, useSES, etc.)
  memoizedState: any;

  // contexts (useContext)
  dependencies: Dependencies | null;

  // effects (useEffect, useLayoutEffect, etc.)
  updateQueue: any;
}
```

here, the `child`, `sibling`, and `return` properties are pointers to other fibers in the tree.

additionally, `memoizedProps`, `memoizedState`, and `dependencies` are the fiber's props, state, and contexts.

while all of the information is there, it's not super easy to work with, and changes frequently across different versions of react. bippy simplifies this by providing utility functions like:

- `traverseRenderedFibers` to detect renders and `traverseFiber` to traverse the overall fiber tree
  - _(instead of `child`, `sibling`, and `return` pointers)_
- `traverseProps`, `traverseState`, and `traverseContexts` to traverse the fiber's props, state, and contexts
  - _(instead of `memoizedProps`, `memoizedState`, and `dependencies`)_

however, fibers aren't directly accessible by the user. so, we have to hack our way around to accessing it.

luckily, react [reads from a property](https://github.com/facebook/react/blob/6a4b46cd70d2672bc4be59dcb5b8dede22ed0cef/packages/react-reconciler/src/ReactFiberDevToolsHook.js#L48) in the window object: `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` and runs handlers on it when certain events happen. this property must exist before react's bundle is executed. this is intended for react devtools, but we can use it to our advantage.

here's what it roughly looks like:

```typescript
interface __REACT_DEVTOOLS_GLOBAL_HOOK__ {
  // list of renderers (react-dom, react-native, etc.)
  renderers: Map<RendererID, reactRenderer>;

  // called when react has rendered everything for an update and the fiber tree is fully built and ready to
  // apply changes to the host tree (e.g. DOM mutations)
  onCommitFiberRoot: (
    rendererID: RendererID,
    root: FiberRoot,
    commitPriority?: number,
  ) => void;

  // called when effects run
  onPostCommitFiberRoot: (rendererID: RendererID, root: FiberRoot) => void;

  // called when a specific fiber unmounts
  onCommitFiberUnmount: (rendererID: RendererID, fiber: Fiber) => void;
}
```

bippy works by monkey-patching `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` with our own custom handlers. bippy simplifies this by providing utility functions like:

- `instrument` to safely patch `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
  - _(instead of directly mutating `onCommitFiberRoot`, ...)_
- `secure` to wrap your handlers in a try/catch and determine if handlers are safe to run
  - _(instead of rawdogging `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` handlers, which may crash your app)_
- `traverseRenderedFibers` to traverse the fiber tree and determine which fibers have actually rendered
  - _(instead of `child`, `sibling`, and `return` pointers)_
- `traverseFiber` to traverse the fiber tree, regardless of whether it has rendered
  - _(instead of `child`, `sibling`, and `return` pointers)_
- `setFiberId` / `getFiberId` to set and get a fiber's id
  - _(instead of anonymous fibers with no identity)_

## how to use

we recommend installing via npm.

this package should be imported before a React app runs. this will add a special object to the global which is used by React for providing its internals to the tool for analysis (React Devtools does the same). as soon as React library is loaded and attached to the tool, bippy starts collecting data about what is going on in React's internals.

```shell
npm install bippy
```

since bippy needs to be imported before react, some bundlers require specific configuration to ensure the correct import order.

### next.js

in next.js 15.3+, use the [`instrumentation-client.js`](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client) file to ensure bippy loads before react. create this file at the root of your application (or inside the `src` folder if you're using the src directory structure):

```typescript
// instrumentation-client.ts
import 'bippy';
```

this file executes before react hydration, making it the ideal place to initialize bippy.

### vite

in vite, import bippy at the very top of your main entry point (typically `src/main.tsx` or `src/main.ts`) before any react imports:

```typescript
// src/main.tsx
import 'bippy';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// ... rest of your code
```

the import order is critical: bippy must be imported before any react packages.

> **note for library maintainers**: if you're building a library and want to define your own utility functions while minimizing bundle size, you can use `bippy/install-hook-only` (~90 bytes) instead of the main `bippy` export. this only installs the react devtools hook without importing any utility functions, allowing you to import only what you need from `bippy/core` or define your own fiber utilities. that said, the full `bippy` package is only ~4kb gzipped, so bundle size is rarely a concern.

> ```typescript
> import 'bippy/install-hook-only'; // only installs the hook
> import { getRDTHook, traverseFiber } from 'bippy/core'; // import only what you need
> import * as React from 'react'; // import react AFTER the hook is installed
>
> const hook = getRDTHook();
> // define your own utilities or use only specific ones
> ```

## API reference

### instrument

patches `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` with your handlers. must be imported before react, and must be initialized to properly run any other methods.

> use with the `secure` function to prevent uncaught errors from crashing your app.

```typescript
import { instrument, secure } from 'bippy'; // must be imported BEFORE react
import * as React from 'react';

instrument(
  secure({
    onCommitFiberRoot(rendererID, root) {
      console.log('root ready to commit', root);
    },
    onPostCommitFiberRoot(rendererID, root) {
      console.log('root with effects committed', root);
    },
    onCommitFiberUnmount(rendererID, fiber) {
      console.log('fiber unmounted', fiber);
    },
  }),
);
```

### getRDTHook

returns the `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` object. great for advanced use cases, such as accessing or modifying the `renderers` property.

```typescript
import { getRDTHook } from 'bippy';

const hook = getRDTHook();
console.log(hook);
```

### traverseRenderedFibers

not every fiber in the fiber tree renders. `traverseRenderedFibers` allows you to traverse the fiber tree and determine which fibers have actually rendered.

```typescript
import { instrument, secure, traverseRenderedFibers } from 'bippy'; // must be imported BEFORE react
import * as React from 'react';

instrument(
  secure({
    onCommitFiberRoot(rendererID, root) {
      traverseRenderedFibers(root, (fiber) => {
        console.log('fiber rendered', fiber);
      });
    },
  }),
);
```

### traverseFiber

calls a callback on every fiber in the fiber tree.

```typescript
import { instrument, secure, traverseFiber } from 'bippy'; // must be imported BEFORE react
import * as React from 'react';

instrument(
  secure({
    onCommitFiberRoot(rendererID, root) {
      traverseFiber(root.current, (fiber) => {
        console.log(fiber);
      });
    },
  }),
);
```

### traverseProps

traverses the props of a fiber.

```typescript
import { traverseProps } from 'bippy';

// ...

traverseProps(fiber, (propName, next, prev) => {
  console.log(propName, next, prev);
});
```

### traverseState

traverses the state (`useState`, `useReducer`, etc.) and effects that set state of a fiber.

```typescript
import { traverseState } from 'bippy';

// ...

traverseState(fiber, (next, prev) => {
  console.log(next, prev);
});
```

### traverseContexts

traverses the contexts (`useContext`) of a fiber.

```typescript
import { traverseContexts } from 'bippy';

// ...

traverseContexts(fiber, (next, prev) => {
  console.log(next, prev);
});
```

### setFiberId / getFiberId

set and get a persistent identity for a fiber. by default, fibers are anonymous and have no identity.

```typescript
import { setFiberId, getFiberId } from 'bippy';

// ...

setFiberId(fiber);
console.log('unique id for fiber:', getFiberId(fiber));
```

### isHostFiber

returns `true` if the fiber is a host fiber (e.g., a DOM node in react-dom).

```typescript
import { isHostFiber } from 'bippy';

if (isHostFiber(fiber)) {
  console.log('fiber is a host fiber');
}
```

### isCompositeFiber

returns `true` if the fiber is a composite fiber. composite fibers represent class components, function components, memoized components, and so on (anything that can actually render output).

```typescript
import { isCompositeFiber } from 'bippy';

if (isCompositeFiber(fiber)) {
  console.log('fiber is a composite fiber');
}
```

### getDisplayName

returns the display name of the fiber's component, falling back to the component's function or class name if available.

```typescript
import { getDisplayName } from 'bippy';

console.log(getDisplayName(fiber));
```

### getType

returns the underlying type (the component definition) for a given fiber. for example, this could be a function component or class component.

```jsx
import { getType } from 'bippy';
import { memo } from 'react';

const RealComponent = () => {
  return <div>hello</div>;
};
const MemoizedComponent = memo(() => {
  return <div>hello</div>;
});

console.log(getType(fiberForMemoizedComponent) === RealComponent);
```

### getNearestHostFiber / getNearestHostFibers

getNearestHostFiber returns the closest host fiber above or below a given fiber. getNearestHostFibers(fiber) returns all host fibers associated with the provided fiber and its subtree.

```jsx
import { getNearestHostFiber, getNearestHostFibers } from 'bippy';

// ...

function Component() {
  return (
    <>
      <div>hello</div>
      <div>world</div>
    </>
  );
}

console.log(getNearestHostFiber(fiberForComponent)); // <div>hello</div>
console.log(getNearestHostFibers(fiberForComponent)); // [<div>hello</div>, <div>world</div>]
```

### getTimings

returns the self and total render times for the fiber.

```typescript
// timings don't exist in react production builds
if (fiber.actualDuration !== undefined) {
  const { selfTime, totalTime } = getTimings(fiber);
  console.log(selfTime, totalTime);
}
```

### getFiberStack

returns an array representing the stack of fibers from the current fiber up to the root.

```typescript
[fiber, fiber.return, fiber.return.return, ...]
```

### getMutatedHostFibers

returns an array of all host fibers that have committed and rendered in the provided fiber's subtree.

```typescript
import { getMutatedHostFibers } from 'bippy';

console.log(getMutatedHostFibers(fiber));
```

### isValidFiber

returns `true` if the given object is a valid React Fiber (i.e., has a tag, stateNode, return, child, sibling, etc.).

```typescript
import { isValidFiber } from 'bippy';

console.log(isValidFiber(fiber));
```

### getFiberFromHostInstance

returns the fiber associated with a given host instance (e.g., a DOM element).

```typescript
import { getFiberFromHostInstance } from 'bippy';

const fiber = getFiberFromHostInstance(document.querySelector('div'));
console.log(fiber);
```

### getLatestFiber

returns the latest fiber (since it may be double-buffered). usually use this in combination with `getFiberFromHostInstance`.

```typescript
import { getLatestFiber } from 'bippy';

const latestFiber = getLatestFiber(
  getFiberFromHostInstance(document.querySelector('div')),
);
console.log(latestFiber);
```

### getFiberSource

returns the source code location of a fiber.

```typescript
import { getFiberSource } from 'bippy/source';

const fiber = getFiberFromHostInstance(document.querySelector('div'));

console.log(await getFiberSource(fiber));
```

> note: in order to get accurate source locations in react >= 19, you need to add this in your `tsconfig.json`:
>
> ```json
> {
>   "compilerOptions": {
>     "jsxImportSource": "bippy/dist"
>   }
> }
> ```

### overrideProps

overrides component props at runtime by modifying the fiber's props.

```typescript
import { overrideProps } from 'bippy';

// override props on a fiber
overrideProps(fiber, {
  title: 'new title',
  config: {
    enabled: true,
    count: 42,
  },
});
```

the function accepts a fiber and a partial object containing the props to override. nested objects are automatically flattened into property paths.

### overrideHookState

overrides hook state (`useState`, `useReducer`, etc.) at runtime by hook id.

```typescript
import { overrideHookState } from 'bippy';

// override the first hook (id: 0) with a new value
overrideHookState(fiber, 0, 'new state value');

// override nested state object
overrideHookState(fiber, 1, {
  user: {
    name: 'john',
    age: 30,
  },
});
```

the hook id parameter corresponds to the order of hooks in the component (0-indexed). the function can accept either a primitive value or an object for nested state updates.

### overrideContext

overrides react context values at runtime by finding the appropriate context provider.

```typescript
import { overrideContext } from 'bippy';

// override context value
overrideContext(fiber, MyContext, {
  theme: 'dark',
  user: {
    id: 123,
    name: 'jane',
  },
});

// override with primitive value
overrideContext(fiber, ThemeContext, 'dark');
```

the function traverses up the fiber tree to find the context provider matching the provided context type and overrides its value.

### getSource

gets the source code location of a composite fiber.

```typescript
import { getSource } from 'bippy/source';

// random fiber on the DOM
const hostFiber = getFiberFromHostInstance(document.querySelector('div'));

// get nearest composite fiber up the tree
const compositeFiber = traverseFiber(
  hostFiber,
  (fiber) => {
    if (isCompositeFiber(fiber)) {
      return fiber;
    }
  },
  true,
);

const source = await getSource(compositeFiber);
// {
//   columnNumber: 12,
//   fileName: 'path/to/file.tsx',
//   lineNumber: 12,
// }
```

> **caveats:**
>
> - only available in dev mode
> - only works for composite fibers (function/class components)
> - captures the location where the component is _used_, not where it's _defined_
> - in react 18, resolves `_debugSource` directly (see [react#31981](https://github.com/facebook/react/issues/31981))
> - in react >18, `_debugSource` is not available for host fibers

## example

here's a mini toy version of [`react-scan`](https://github.com/aidenybai/react-scan) that highlights renders in your app.

```javascript
import {
  instrument,
  secure,
  getNearestHostFiber,
  traverseRenderedFibers,
} from 'bippy'; // must be imported BEFORE react

const highlightFiber = (fiber) => {
  if (!(fiber.stateNode instanceof HTMLElement)) return;
  // fiber.stateNode is a DOM element
  const rect = fiber.stateNode.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.style.border = '1px solid red';
  highlight.style.position = 'fixed';
  highlight.style.top = `${rect.top}px`;
  highlight.style.left = `${rect.left}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.style.zIndex = '999999999';
  document.documentElement.appendChild(highlight);
  setTimeout(() => {
    document.documentElement.removeChild(highlight);
  }, 100);
};

/**
 * `instrument` is a function that installs the react DevTools global
 * hook and allows you to set up custom handlers for react fiber events.
 */
instrument(
  /**
   * `secure` is a function that wraps your handlers in a try/catch
   * and prevents it from crashing the app. it also prevents it from
   * running on unsupported react versions and during production.
   *
   * this is not required but highly recommended to provide "safeguards"
   * in case something breaks.
   */
  secure({
    /**
     * `onCommitFiberRoot` is a handler that is called when react is
     * ready to commit a fiber root. this means that react is has
     * rendered your entire app and is ready to apply changes to
     * the host tree (e.g. via DOM mutations).
     */
    onCommitFiberRoot(rendererID, root) {
      /**
       * `traverseRenderedFibers` traverses the fiber tree and determines which
       * fibers have actually rendered.
       *
       * A fiber tree contains many fibers that may have not rendered. this
       * can be because it bailed out (e.g. `useMemo`) or because it wasn't
       * actually rendered (if <Child> re-rendered, then <Parent> didn't
       * actually render, but exists in the fiber tree).
       */
      traverseRenderedFibers(root, (fiber) => {
        /**
         * `getNearestHostFiber` is a utility function that finds the
         * nearest host fiber to a given fiber.
         *
         * a host fiber for `react-dom` is a fiber that has a DOM element
         * as its `stateNode`.
         */
        const hostFiber = getNearestHostFiber(fiber);
        highlightFiber(hostFiber);
      });
    },
  }),
);
```

## glossary

- fiber: a "unit of execution" in react, representing a component or dom element
- commit: the process of applying changes to the host tree (e.g. DOM mutations)
- render: the process of building the fiber tree by executing component function/classes
- host tree: the tree of UI elements that react mutates (e.g. DOM elements)
- reconciler (or "renderer"): custom bindings for react, e.g. react-dom, react-native, react-three-fiber, etc to mutate the host tree
- `rendererID`: the id of the reconciler, starting at 1 (can be from multiple reconciler instances)
- `root`: a special `FiberRoot` type that contains the container fiber (the one you pass to `ReactDOM.createRoot`) in the `current` property
- `onCommitFiberRoot`: called when react is ready to commit a fiber root
- `onPostCommitFiberRoot`: called when react has committed a fiber root and effects have run
- `onCommitFiberUnmount`: called when a fiber unmounts

## misc

bippy was initially created for [react-scan](https://github.com/aidenybai/react-scan), which is deployed with proper safeguards to ensure it's only used in development or error-guarded in production.

if you're seeking more robust solutions, you might consider [its-fine](https://github.com/pmndrs/its-fine) for accessing fibers within react using hooks, or [react-devtools-inline](https://www.npmjs.com/package/react-devtools-inline) for a headful interface.

if you plan to use this project beyond experimentation, please review [react-scan's source code](https://github.com/aidenybai/react-scan) to understand our safeguarding practices.

the original bippy character is owned and created by [@dairyfreerice](https://www.instagram.com/dairyfreerice). this project is not related to the bippy brand, i just think the character is cute.
