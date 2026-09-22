---
meta:
  title: How Bippy analyzes React source
  contentType: Conceptual
  audience: Readers who know React but not the analyzer
  goal: Explain how source evaluation produces React elements and captured fiber trees
  plan: Follow unknown props through interpretation, scopes, proxies, state, queued work, and comparison
---

# How Bippy analyzes React source

Bippy records the component tree of a running React app. [PR #115](https://github.com/aidenybai/bippy/pull/115) adds an analyzer that predicts that tree from source, including alternatives for unknown inputs. It interprets application code, converts the results into React elements, and uses real React to render them.

This describes checkpoint `768bc78f`, including fixes made after the original PR. Simplified implementation excerpts are labeled below.

## Unknown props

This app renders one of two screens:

```tsx
import { Dashboard, Login } from "./ui";

interface AppProps {
  loggedIn: boolean;
}

export const App = ({ loggedIn }: AppProps) => (loggedIn ? <Dashboard /> : <Login />);
```

With `loggedIn = true`, React renders `Dashboard`. With `false`, it renders `Login`.

If you don’t know `loggedIn`, omitting it won’t make JavaScript consider both values. The missing prop is `undefined`, so this component selects `Login`. The TypeScript annotation doesn’t change that behavior.

Use the analyzer’s value builders to distinguish a known value, an unknown Boolean, and a missing property:

```ts
const concreteProps = objectFromRecord({
  loggedIn: primitiveValue(true),
});

const uncertainProps = objectFromRecord({
  loggedIn: unknownPrimitiveValue("boolean", "loggedIn"),
});

const missingProps = objectFromRecord({});
```

The intended results are:

```text
concreteProps  → Dashboard
uncertainProps → Dashboard when true, Login when false
missingProps   → Login
```

For `uncertainProps`, the analyzer retains both results and the condition selecting each one. It doesn’t choose a Boolean and run only that path.

To supply these inputs, put `App` in `example-app/app.tsx` with working `./ui` imports. A script at this repository’s root can import the renderer and internal value builders:

```ts
import { createStaticRenderer, objectFromRecord } from "./packages/bippy-analyzer/src/index.js";
import {
  primitiveValue,
  unknownPrimitiveValue,
} from "./packages/bippy-analyzer/src/evaluate/values.js";
```

Pass `uncertainProps` to `renderComponent`:

```ts
const renderer = await createStaticRenderer({
  rootDirectory: "./example-app",
});

const prediction = await renderer.renderComponent("app.tsx", {
  exportName: "App",
  props: uncertainProps,
});
```

These are interpreter values, not ordinary React props. `unknownPrimitiveValue("boolean", "loggedIn")` creates this object:

```text
{
  kind: "unknown-primitive",
  primitiveType: "boolean",
  reason: "loggedIn"
}
```

The interpreter recognizes the `unknown-primitive` tag. Passing that object as `loggedIn` to the original component would select `Dashboard`, because the object is truthy.

## Interpreting JavaScript

For a known input, the interpreter computes one result:

```tsx
interface PriceProps {
  price: number;
}

export const Price = ({ price }: PriceProps) => {
  const total = price + 5;
  return <span>{total}</span>;
};
```

With `price = 10`, `Price` returns a `span` containing `15`. The interpreter calculates this by reading the parsed instructions, not by calling the original function natively.

`oxc-parser` parses the file into an abstract syntax tree, or AST. The tree represents instructions such as “read `price`,” “add `5`,” and “return an element.” Parsing alone doesn’t execute them.

To evaluate the function, the interpreter binds `price` in a name-to-value table called a scope. It then evaluates the addition and stores `total`:

```text
Bind price → { kind: "primitive", value: 10 }
Read price → { kind: "primitive", value: 10 }
Read 5     → { kind: "primitive", value: 5 }
Add        → { kind: "primitive", value: 15 }
Bind total → { kind: "primitive", value: 15 }
```

The `primitive` tag identifies a known value. Unlike the unknown Boolean above, both operands are known, so the addition has one result.

For `<span>{total}</span>`, the interpreter returns this element description. Source and ownership metadata are omitted:

```text
kind: "element"
type: { kind: "host", tagName: "span" }
key: null
props:
  kind: "object"
  entries:
    - kind: "property"
      key: "children"
      value: { kind: "primitive", value: 15 }
```

This is data describing the return value, not a React element or browser node.

### Component exports

Before mounting, `renderComponent` resolves `App` and creates a modeled element that refers to it. This excerpt uses the named `App` export and omits setup and error handling:

```ts
const componentValue = run.interpreter.evaluateModuleExport(module, "App");
const element: StaticValue = {
  kind: "element",
  type: toElementType(componentValue, "App"),
  key: null,
  props: options.props ?? objectValue([]),
  location: null,
  environment: null,
  owner: null,
};
return this.finish(run, element);
```

Here, `evaluateModuleExport` produces a function value containing the parsed body and its surrounding scope. It hasn’t called `App`. `finish` starts the conversion to React elements and the mount that causes React to invoke the component’s proxy.

### Import resolution

Suppose `format-name.ts` exports a helper:

```ts
export const formatName = (name: string) => `Hello ${name}`;
```

`Greeting` imports and calls it:

```tsx
import { formatName } from "./format-name";

export const Greeting = () => <span>{formatName("Ada")}</span>;
```

`oxc-resolver` locates `format-name.ts`, and the module graph finds the exported declaration. At the call, the interpreter binds `name` to `"Ada"` and evaluates the template string. The result, `"Hello Ada"`, becomes the `span`’s child.

For a re-export, the graph follows another declaration. If `ui/index.ts` re-exports `Loading` from `./loading`, lookup continues in `ui/loading.tsx`. Resolving that declaration doesn’t invoke `Loading`.

For `clsx`, the analyzer loads the project’s installed package. It doesn’t reimplement the class-name logic. With known arguments, it can call the actual function:

```ts
import { clsx } from "clsx";

export const className = clsx("button", { active: true });
```

The analyzer converts the arguments to native JavaScript values, calls the installed `clsx`, and wraps the returned `"button active"` string as an interpreter value.

The loader resolves the copy used by the project’s import, including a dependency’s nested copy when applicable. It doesn’t install missing packages. The repository lists `clsx` as a development dependency for tests, not as a bundled replacement for another app’s copy.

The loader and argument/result conversion are shared across helpers. There isn’t a separate implementation of that machinery for `clsx` and `classnames`. The shared wrapper in `evaluate/native-values.ts` calls the installed function with `Reflect.apply`.

Which functions may use that wrapper is package- and export-specific. `libraries/pure-packages.ts` lists supported packages and excludes selected exports. For example, it permits `clsx` but excludes `lodash.debounce` and `lodash.throttle` from this native path. Functions that depend on timers, mutable module state, clocks, or randomness need other handling.

For unknown arguments, the analyzer can try interpreting the helper’s own source. If that isn’t possible, the result stays uncertain. Dependency source analysis also has `resolveExternalPackages` and `externalPackageAllowList` settings. These control source interpretation, not permission to run every installed package natively.

Other APIs have handwritten models. The imported React `useState` selects the analyzer’s hook model instead of evaluating React’s own implementation. These models implement selected behavior, not entire replacement packages. An unrelated local function named `useState` remains an ordinary function.

## Scopes and closures

`createGreeting` returns a component that uses its `prefix` argument:

```tsx
import { formatName } from "./format-name";

interface GreetingProps {
  name: string;
}

const suffix = "!";
const createGreeting = (prefix: string) => {
  const Greeting = ({ name }: GreetingProps) => (
    <span>
      {prefix}
      {formatName(name)}
      {suffix}
    </span>
  );
  return Greeting;
};

export const Welcome = createGreeting("Admin: ");
```

For `<Welcome name="Ada" />`, the interpreter reads these values:

```text
name             → "Ada"       from this call's props
prefix           → "Admin: "   from the captured factory call
formatName(name) → "Hello Ada" from the imported helper
suffix           → "!"         from the module binding

Child text: "Admin: Hello Ada!"
```

`Greeting` can read `prefix` after `createGreeting` returns because its function value retains the surrounding scope. A function with that retained scope is a closure.

To find `prefix`, lookup starts in the component’s call scope, then checks the captured factory scope. This is the parent-chain search in `evaluate/scope.ts`:

```ts
export const lookupScope = (scope: Scope, name: string): StaticValue | undefined => {
  let current: Scope | null = scope;
  while (current) {
    const value = current.bindings.get(name);
    if (value !== undefined) return value;
    current = current.parent;
  }
  return undefined;
};
```

If no lexical scope contains the name, the interpreter checks module bindings, configured definitions, and modeled globals. It also resolves supported compiler-injected runtime names and auto-imports. It doesn’t search arbitrary globals in the analyzer process.

If the active environment establishes that a name is absent, lookup produces a modeled `ReferenceError`. Otherwise, an unresolved name remains an unknown value. Repeated reads of that name in the same run, module, and environment reuse one identity rather than becoming independent inputs.

Each factory call must retain its own variables:

```ts
const createLabel = (prefix: string) => {
  let count = 0;
  return () => `${prefix}:${++count}`;
};

const firstLabel = createLabel("A");
const secondLabel = createLabel("A");
const labels = [firstLabel(), firstLabel(), secondLabel()];
```

`labels` is `["A:1", "A:2", "A:1"]`. Both functions use the same parsed body, but their captured `count` variables differ. Caching them by source location alone would merge the counters.

Imports can refer to one object under different names. Suppose `counter.ts` contains `export const counter = { count: 0 }`:

```ts
import { counter as firstCounter } from "./counter";
import { counter as secondCounter } from "./counter";

export const readAfterWrite = () => {
  firstCounter.count = 7;
  return secondCounter.count;
};
```

The result is `7`. Both imports refer to the same evaluated module binding. Within the run and environment, the interpreter caches that object rather than evaluating `{ count: 0 }` for each import.

React ancestry doesn’t create a lexical scope. A module-level `Child` can’t read a local variable in `Parent` because `Parent` renders `<Child />`. It needs a prop, a closure, or an explicit context read.

## React elements and component proxies

The materializer converts the interpreter’s `span` description into a real React element:

```tsx
React.createElement("span", { children: 15 });
```

For a host tag, it converts the modeled props and children, then passes the string tag to React.

For `<App />`, React needs a function it can call, not an object describing a parsed body. The materializer creates a function that invokes the interpreter. This component proxy is an ordinary React component, not JavaScript’s `new Proxy(...)`.

Consider a component with no props, hooks, or branches:

```tsx
const App = () => <button>Hello</button>;
```

This simplified proxy evaluates its body and converts the result. `parsedApp` is the interpreter’s function value. `evaluationContext` supplies the active scope and execution state:

```tsx
const AppProxy = () => {
  const modeledResult = interpreter.callFunction(parsedApp, [], evaluationContext);

  return materializer.toRootNode(modeledResult);
};

root.render(React.createElement(AppProxy));
```

React calls `AppProxy`. The interpreter evaluates `App` and returns a description of the button. The materializer creates a real button element, which the proxy returns to React.

The interpreter uses the source function’s captured scope, not the wrapper’s native scope. A proxy for `Welcome` can therefore still find its captured `prefix`.

In production, `renderFunctionProxy` uses `renderStateful` and `finishRender` to retain hook state and branch context. Nested proxies reuse their analysis context rather than calling `toRootNode` as this shortened example does.

Nested source components get proxies too:

```text
Source components             Types React renders

App                           AppProxy
└─ Layout                     └─ LayoutProxy
   └─ Counter                    └─ CounterProxy
      └─ button                     └─ "button"
```

`CounterProxy` asks the interpreter to evaluate `Counter`. The host button needs no proxy because React DOM understands `"button"`. Source classes use class proxies. Context, memo, forwarded refs, lazy components, and Suspense have separate adapters.

The materializer’s element-type switch contains these host and function cases:

```ts
switch (type.kind) {
  case "host":
    return createElement(
      type.tagName,
      this.hostProps(type.tagName, props, reactKey, location, context),
    );
  case "function":
    return createElement(this.getFunctionProxy(type.component), {
      key: reactKey,
      input: proxyInput(),
    });
}
```

`proxyInput()` packages the modeled props and analysis context. `getFunctionProxy` returns a cached wrapper. Without that cache, a new wrapper on each render would change the component type and could cause a remount.

Two `<Counter />` elements use the same proxy function but keep separate instance state. The cache also distinguishes components created with different captured scopes, even if their display names match.

### Fibers and reconciliation

`React.createElement` creates an element object, not a fiber. React creates or reuses fibers when it reconciles the elements supplied to the root.

A fiber records an occurrence in the tree, including its type, links to other fibers, and rendering state. For the button example:

```text
Element with type AppProxy
    ↓ React calls AppProxy
Returned element with type "button"
    ↓ React reconciles the child
Function-component fiber for AppProxy
└─ Host-component fiber for button
```

In React `v19.2.4`, `updateFunctionComponent` calls `renderWithHooks`, then reconciles the returned children. `reconcileSingleElement` checks keys and types before reusing a fiber or calling `createFiberFromElement`. The analyzer uses this reconciler rather than implementing another one.

The harness mounts with React DOM in happy-dom, a browser-like environment inside Node. DOM means Document Object Model, the browser’s representation of document nodes. The harness tries to load the app’s supported React installation and falls back to its own runtime where required.

A component fiber doesn’t require an HTML element of its own. React also handles fragments and text specially. Supported server-component evaluation can produce children without a corresponding client component fiber.

Proxies receive source display names, so Bippy can report `App` even though React called its proxy. The fibers are real, but they describe the interpreter’s result. That result may still be wrong.

## Conditional rendering

For an unknown `loggedIn`, the materializer creates marker components around the alternatives:

```text
App
└─ Branch: loggedIn
   ├─ Alternative: true
   │  └─ Dashboard
   └─ Alternative: false
      └─ Login
```

The combined analysis can mount both subtrees. The comparison code reads the markers as a choice between trees, not as a claim that the app displays both screens together.

The selecting conditions are called guards. They must stay attached to results when several expressions use the same input:

```tsx
const label = loggedIn ? "Account" : "Sign in";
const screen = loggedIn ? <Dashboard /> : <Login />;
```

The valid pairs are `Account` with `Dashboard`, and `Sign in` with `Login`. Independent choices would also invent `Account` with `Login`. Both conditionals must refer to the same input.

### SSA execution

```ts
const getValue = (flag: boolean) => {
  let value = 3;
  while (flag) {
    value = 4;
    break;
  }
  return value;
};
```

For an explicitly modeled unknown Boolean, `getValue` must return `3` when `flag` is false and `4` when it is true. An earlier guarded-execution regression admitted the wrong value on the false path.

Eligible function bodies now execute a control-flow graph rather than walking the AST. Each assignment gets a separate identity. At a join, the incoming edge selects the value. This is single static assignment, or SSA. A simplified view of this example is:

```text
value₀ = 3
true edge: value₁ = 4
join: value₂ = phi(true edge: value₁, false edge: value₀)
return value₂
```

Loop phis carry values from one iteration to the next. The executor uses the existing guards, step budget, and loop bound. Compiler passes remove redundant phis, verify that definitions precede their uses, and propagate constants along executable edges.

This is not a complete SSA runtime. Scalar function bodies and tested exception paths can use it; mutable captures, arbitrary heap operations, calls, JSX construction, async functions, and generators still use the existing evaluator. Compiler constants are not substituted into that fallback's reads. The [research notes](packages/bippy-analyzer/docs/compiler-research.md#ssa-execution) explain the boundary and the React Compiler adaptation.

### Narrowing

An unknown input can become more specific as its tests succeed:

```ts
const getLabel = (value: unknown) => {
  if (typeof value === "string" && value === "ready") {
    return value.toUpperCase();
  }
  return "waiting";
};
```

The first test establishes that `value` is a string. The second establishes that it is `"ready"`, so the true path returns `"READY"`. The interpreter applies the second refinement to the first one's result, following TypeScript's flow-narrowing algorithm.

Narrowing reads modeled values rather than running the test again. Re-running a getter to find a more precise value used to add writes that native execution never made. Compound tests that can invoke user code skip this extra refinement; they still execute normally.

The rules use runtime value information, not annotations. They also preserve distinctions a type checker can ignore: `value === 0` doesn't prove positive zero, because `-0` passes too. The [compiler research notes](packages/bippy-analyzer/docs/compiler-research.md) explain the adaptations and tests.

### Branch mutations

A branch can change a value that a later statement reads:

```ts
const getLabel = (loggedIn: boolean) => {
  const box = { label: "unset" };
  const alias = box;

  if (loggedIn) alias.label = "Account";
  else box.label = "Sign in";

  return box.label;
};
```

`alias` and `box` refer to the same object. If the interpreter explores both paths without restoring `box`, the false path overwrites the true path’s result.

For supported branches, a journal records the writes needed to restore the entry state. The interpreter saves the true path’s result, restores `box.label` to `"unset"`, then evaluates the false path. Each saved result keeps its guard:

```text
loggedIn = true  → box.label = "Account" → return "Account"
loggedIn = false → box.label = "Sign in" → return "Sign in"
```

The journal must also record writes inside getters:

```ts
let reads = 0;
const source = {
  get label() {
    reads++;
    return "Account";
  },
};

const label = source.label;
```

`source.label` returns `"Account"` and leaves `reads = 1`. If the read runs under a guard, the increment must keep that guard.

In `<Panel title={readTitle()}>{readBody()}</Panel>`, the interpreter evaluates `readTitle()` before `readBody()`. If the first call throws, the second must not run. Creating this element doesn’t invoke `Panel`’s body. React reaches its proxy later.

### Unanalyzed components

Suppose `react-chartjs-2` is installed, but neither its source nor a component model is enabled for analysis:

```tsx
import { Line } from "react-chartjs-2";

export const ChartPanel = () => <Line />;
```

The analyzer can record `ChartPanel → Line` while leaving `Line`’s children unknown. It uses an opaque marker rather than inventing a canvas tree. Enabling source analysis can change how it handles this package.

A repeat marker can represent a list whose length is unknown, with constraints on the allowed counts. Unknown text records text without choosing its contents. If a limit stops exploration, unvisited alternatives remain unchecked. Preferring one alternative doesn’t rule out the others.

Mounting alternatives under markers doesn’t isolate their application state. Mutations to shared objects can still interfere across subtrees. The journal restores supported interpreted branches, not every interaction between mounted alternatives.

## State and effects

Add `ready` and an effect to `App`:

```tsx
import { useEffect, useState } from "react";
import { Dashboard, Layout, Loading, Login } from "./ui";

interface AppProps {
  loggedIn: boolean;
}

export const App = ({ loggedIn }: AppProps) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return <Loading />;

  return <Layout>{loggedIn ? <Dashboard /> : <Login />}</Layout>;
};
```

On the first pass, `ready` is false. The interpreter registers the effect without running it and stops at `return <Loading />`. It doesn’t evaluate the later `Layout` return.

The materializer creates a `Loading` element, and React renders its proxy and commits the tree. React then runs the effect wrapper, which invokes the interpreted callback. That callback calls the modeled `setReady(true)`.

The setter queues the application-state update and requests a React rerender. `renderFunctionProxy` stores the component instance in a native ref and uses native state to trigger renders:

```ts
const instanceRef = useRef<ProxyInstance | null>(null);
instanceRef.current ??= createProxyInstance(input.context, this.interpreter);
const [, setPass] = useState(0);
```

`instanceRef.current.frame` stores the application’s hook cells. Calling `setPass` makes React render the proxy again. Its native counter is separate from the application’s `ready` value.

On the next invocation, the interpreter applies the queued update before evaluating `App`:

```text
First invocation:
  hook cell = false
  local ready = false
  return Loading

Effect:
  queue true in that hook cell
  request a proxy rerender

Next invocation:
  apply the queued true
  local ready = true
  return Layout with conditional Dashboard/Login
```

The previous invocation’s local `ready` hasn’t changed. The new invocation reads `true` from the persistent cell. Each pass restarts the hook-call counter so the first `useState` finds the first cell, rather than creating fresh state.

With `count = 0`, both calls below supply `1`:

```ts
setCount(count + 1);
setCount(count + 1);
```

The queued value ends at `1`. Functional updates instead read the pending state in sequence:

```ts
setCount((previous) => previous + 1);
setCount((previous) => previous + 1);
```

The first receives `0` and returns `1`. The second receives `1` and returns `2`. The interpreter calculates these updates before React rerenders the proxy.

### Effect cleanup

Each supported function-effect registration gets its own native layout or passive effect hook. React orders those hooks across components, rather than the analyzer running effects immediately after each component body.

This setup subscribes to a channel and returns its cleanup:

```tsx
useEffect(() => {
  const unsubscribe = subscribe(channel);
  return () => unsubscribe();
}, [channel]);
```

If channel A’s setup commits, its cleanup must unsubscribe from A. An uncommitted render for B must not replace it with B’s callback. The wrapper captures the cleanup returned by its own setup. If B never commits, the next dependency comparison must still use A.

`useContext` reads from the proxy’s position in React’s tree. For `<Theme.Provider value="dark"><Badge /></Theme.Provider>`, the materializer creates a real provider containing the modeled value. When interpreted `Badge` calls `useContext(Theme)`, its proxy reads that provider. This is separate from looking up variables in lexical scopes.

### State between analysis runs

These calls start separate runs:

```ts
const firstRun = await renderer.renderComponent("app.tsx", {
  exportName: "App",
  props: uncertainProps,
});
const secondRun = await renderer.renderComponent("app.tsx", {
  exportName: "App",
  props: uncertainProps,
});
```

The first run’s effect sets its `ready` cell to true. The second creates a new interpreter and component instances, so it starts with `ready = false` and can record `Loading` again. Parsed source records can remain cached without retaining those hook cells.

Each run also creates a new mount host. Selected native modules and process globals can remain shared. Fresh modeled state does not mean process isolation or a security sandbox.

## Abandoned renders

React can abandon a render after a parent has updated modeled state:

```text
Last accepted parent state: 0
    ↓
Parent's attempted render changes modeled state to 1
    ↓
Child throws a pending promise
    ↓
React abandons that primary-tree attempt
```

React restores its own rendering state, but it can’t restore the interpreter’s hook cells. Keeping the parent’s change would incorrectly retain `1` from a render that never committed.

The materializer keeps a checkpoint until React accepts the render. On supported abandonment paths, it undoes that render’s hook and memo changes without replacing committed effects.

Updates received from outside the attempted render must survive. A helper-level regression test covers this sequence:

```text
Original state: 0
First uncommitted attempt produces: 1
External update queues: 2
Retry consumes the update to 2
Retry is discarded

Required: restore the base while keeping the external update available
Old bug: restore 0 and lose the external update entirely
```

The checkpoint now records incoming updates before a retry consumes them. Reducers also need their action history. Incoming `+2` and later `+4` must survive a discarded render-phase `+1`, leaving `6`, not `4` or `7`.

If the update to `2` was queued only when `loggedIn` is true, it must stay absent on the false path. That path reads the restored base state `0`, not the abandoned value `1`.

An application throw doesn’t undo earlier object writes:

```ts
const state = { count: 0 };
let observed = 0;

try {
  state.count = 1;
  throw new Error("stop");
} catch {
  observed = state.count;
}
```

`observed` becomes `1`. Ordinary shared-object and ref writes also remain when a render is discarded. The checkpoint restores its hook metadata and queues, not all executed JavaScript.

An internal analyzer failure differs from an application throw. If the analyzer fails while exploring a branch, it restores the branch’s entry state and unwinds its guard and journal stacks.

For Suspense, the materializer throws a real promise corresponding to the modeled pending promise. When the modeled promise settles, the adapter resolves the cached real promise so React can retry.

The materializer tracks pending renders under each Suspense boundary. If a descendant suspends, it can discard affected parents and siblings that finished evaluating earlier. Tests cover descendant suspension and leftover sibling-prewarming attempts. Non-Suspense abandonment and further interrupted update histories remain incomplete.

## Timers and microtasks

Registering a callback must not execute it before the remaining synchronous code:

```ts
const trace: string[] = [];

queueMicrotask(() => trace.push("microtask"));
setTimeout(() => trace.push("timer"), 0);
trace.push("sync");
```

The expected trace is `sync`, `microtask`, `timer`. The modeled queue drains eligible microtasks before the next timer. While settling queued work, the harness uses React’s `act` helper to flush React work, including renders requested by setters.

The queue stores each registration’s callback, identity, parent task, condition, and pending state. A timer handle identifies which registration `clearTimeout` cancels. Consuming a task on one analysis path must not remove it from sibling paths, so the journal records changes to its pending state.

Suppose `Dashboard` starts a timer and cancels it in cleanup:

```tsx
useEffect(() => {
  const handle = setTimeout(() => setLoaded(true), 0);
  return () => clearTimeout(handle);
}, []);
```

`Dashboard` exists only when `loggedIn` is true, so the timer must retain that condition. An unrelated later commit must not make the callback unconditional. The serialized result must also identify the input referenced by the condition.

A callback that schedules itself 150 times isn’t a synchronous call stack 150 frames deep. Each queued invocation starts a new stack. Direct recursion still counts toward the call-depth limit.

A resumed `await` gets a fresh execution budget, but synchronous calls within that task share it. A previous defect gave repeated calls after `await` fresh budgets. The fix stores one budget per task without raising the limits.

The harness stops after bounded settling work. It doesn’t generate arbitrary clicks or explore every event order. If modeled tasks remain at capture, diagnostics report that they didn’t settle within the bound. A promise known to be pending remains distinct from one whose settlement depends on unknown external behavior.

## Fiber capture and comparison

Bippy records the committed fibers through React DevTools instrumentation. Capturing only the HTML would lose component names:

```text
DOM nodes                    Fiber structure

div                          App
└─ button                    └─ Login
                                └─ div
                                   └─ button
```

The recorder selects the relevant root and serializes fiber kinds, names, keys, text, selected primitive props, and children. Later commits can’t change the stored snapshot.

For the effectful `App`, the result can contain both `App → Loading` and the later `App → Layout → conditional Dashboard/Login`. It also includes diagnostics and the conditions associated with commits.

The harness records pending work before final cleanup. Otherwise, cleanup could cancel a timer and erase a capture-time warning, or create a microtask and falsely make the captured run appear unsettled.

The comparison harness also runs the actual app through normal JavaScript and React:

```text
Prediction:
Source → interpreter → materializer → React → Bippy snapshot

Observation:
Actual app → normal JavaScript and React → Bippy snapshot
```

The pattern reader converts prediction markers into choices and constraints. The comparison uses fiber kind, name, key, and children, not every captured prop. A structural match isn’t a screenshot comparison or proof of all application behavior.

Checking only the set of screens would miss reversed guards:

| Input              | Correct prediction | Broken prediction |
| ------------------ | ------------------ | ----------------- |
| `loggedIn = true`  | `Dashboard`        | `Login`           |
| `loggedIn = false` | `Login`            | `Dashboard`       |

Both columns contain `{Dashboard, Login}`. The assignment-sensitive tests check which result each input selects from one combined analysis, then compare it with native execution. Other tests check values, writes, throws, and callback order that the tree can hide.

Comparison can include intermediate commits. A runtime `Loading` tree may match the initial predicted commit, not the settled one. The report’s matched state and conditions identify which case passed.

Matching around an opaque `Line` doesn’t check its unknown children. Unexplored alternatives remain unchecked. Replay can help investigate a mismatch, but a successful replay or separate concrete run doesn’t prove the original combined analysis was correct.

## Entry-point analysis

`renderComponent` takes an export name and props. `renderEntry` instead follows the app’s root-render call. For example, `example-app/main.tsx` could contain:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./app";

const container = document.createElement("div");
document.body.append(container);
createRoot(container).render(<App loggedIn={true} />);
```

Analyze it with the same renderer:

```ts
const entryPrediction = await renderer.renderEntry("main.tsx");
```

`renderEntry` evaluates supported code leading to the root-render call and uses its element argument. Here, `loggedIn` is known to be true because the entry supplies `true`. Reading source doesn’t make a known input unknown.

## Native execution

JSX needing execution doesn’t require a custom interpreter. The JavaScript engine can execute the application, and React can render its result. A bundler can resolve imports and transform TypeScript and JSX without replacing JavaScript evaluation.

After loading the original `App`, a native render can use concrete props:

```tsx
root.render(<App loggedIn={true} />);
```

For the effectful example, this renders `Loading` first and `Dashboard` after the effect settles. A separate run with `false` reaches `Login`. Bippy can capture both without modeling application hooks or JavaScript operations itself.

That approach uses the actual JavaScript engine and React for the supplied inputs and environment. It avoids interpreter mistakes in closures, getters, exceptions, and hook updates. It still needs dependencies, an appropriate runtime environment, and inputs. Executing an application can also run its network requests, timers, and other side effects.

The interpreter retains results under unknown inputs. A native `if (loggedIn)` selects one path. Passing a symbolic object as `loggedIn` doesn’t change that, because objects are truthy. The custom interpreter can instead retain `loggedIn = true → Dashboard` and `loggedIn = false → Login` in one analysis result.

For one Boolean, running both values is a reasonable alternative. Exhaustively enumerating ten independent Booleans means 1,024 assignments. Unknown strings, list lengths, and event histories also need choices or bounds. Native runs establish what happened for the cases executed, not every untried case. The interpreter still faces branching limits and unsupported behavior, so a combined result is not automatically complete or cheaper.

The tests already use native execution to check predictions. `tests/helpers/component-runner.ts` imports the real fixture component and mounts it with React. JavaScript differential tests also evaluate snippets with the engine and compare their results with the interpreter.

A native backend is preferable when the goal is to capture an app that can run with concrete inputs. Keep custom interpretation for requirements that need unknown-input predictions. The current analyzer’s normal renderer remains interpreter-based; its native helper calls and test runs are not a general native backend.

Switching a component to native execution midway through analysis would need more than `eval`. Its props and captured variables must become usable native values, and its writes and callbacks must remain consistent with modeled state. Selected helper calls have conversion rules for this, not a blanket guarantee for arbitrary components.

## Fixes and remaining limits

The fixes leave public renderer calls, real React rendering, and serialized fiber-pattern output unchanged.

The property fixes distinguish copying data from invoking setters. `{ ...source }` reads source getters and creates data properties. `Object.assign(target, source)` writes to the target and can invoke its setters. Related fixes cover descriptor flags, freeze/seal restrictions, key order, and callback execution.

The latest full coverage run passed 23,301 tests. Of those, 1,353 assertions confirm known defects rather than correct JavaScript or React behavior. Seven former known-defect cases now match native execution and are ordinary regressions. The strict compatibility check still fails because known defects and incomplete coverage in 238 source files remain. The [compiler research notes](packages/bippy-analyzer/docs/compiler-research.md#validation) record this run; the [implementation progress](docs/pr-115-implementation-progress.md) records earlier checkpoints and performance measurements.

Some gaps have direct effects on predictions. The current `useTransition` model reports `pending = false` and invokes the transition callback directly. `useDeferredValue` returns its input. Neither reproduces React’s deferred scheduling.

Other unfinished cases include:

- Non-Suspense abandonment, further interrupted update histories, and effect dependencies that vary under unknown conditions.
- Object integrity and enumeration on arrays, functions, classes, proxies, and native targets.
- General async and generator suspension, including unsupported await expressions and asynchronous loops.
- Effects of unknown or native calls, including mutations, exceptions, retained callbacks, and scheduled work.
- Interference between combined alternatives through shared application state.

An internal runner can rerun a finite set of supplied assignments with fresh modeled state. It isn’t the default backend, doesn’t isolate native processes, and doesn’t explore every browser history. The [execution contracts](packages/bippy-analyzer/docs/execution-contracts.md) describe these limits. The [implementation plan](docs/pr-115-implementation-plan.md) remains partially complete, and broader live-application validation is outstanding.

For a tree from one actual execution, run the app and capture it with Bippy. Use source analysis when you need alternatives before supplying inputs such as `loggedIn`, and read the guards and diagnostics alongside the predicted tree.

## Source files

Paths below are relative to `packages/bippy-analyzer/src/`:

| Operation                                          | Implementation                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Start and finish an analysis                       | `render/static-renderer.ts`: `renderEntry`, `renderComponent`, `finish`                                              |
| Parse source and resolve imports                   | `parse/parse-source-file.ts`, `graph/module-graph.ts`, `graph/module-resolver.ts`                                    |
| Load and call installed helpers                    | `libraries/pure-packages.ts`, `libraries/installed-modules.ts`, `evaluate/native-values.ts`                          |
| Look up lexical variables                          | `evaluate/scope.ts`: `lookupScope`                                                                                   |
| Evaluate source functions and JSX                  | `evaluate/interpreter.ts`: `callFunction`, `evaluateJsxElement`                                                      |
| Compile control flow and local definitions         | `compiler/bindings.ts`, `compiler/lower-function.ts`, `compiler/enter-ssa.ts`                                        |
| Simplify and verify SSA                            | `compiler/eliminate-phis.ts`, `compiler/verify-ssa.ts`, `compiler/propagate-constants.ts`                            |
| Select and execute SSA bodies                      | `compiler/compile-function.ts`, `evaluate/ssa-execution.ts`                                                          |
| Refine tested values and preserve Boolean identity | `evaluate/narrowing.ts`, `evaluate/operators.ts`                                                                     |
| Execute modeled hooks                              | `evaluate/react-hooks.ts`, `evaluate/hooks.ts`                                                                       |
| Restore and join branch mutations                  | `evaluate/heap-journal.ts`, `evaluate/scope-journal.ts`                                                              |
| Create elements and component proxies              | `materialize/materializer.ts`: `toNode`, `getFunctionProxy`, `renderFunctionProxy`, `renderStateful`, `commitRender` |
| Mount, flush work, and capture before disposal     | `materialize/mount.ts`, `evaluate/timers.ts`                                                                         |
| Record committed fibers                            | `harness/commit-recorder.ts`, `harness/snapshot.ts`                                                                  |
| Read markers and compare trees                     | `harness/static-pattern.ts`, `harness/compare-render.ts`                                                             |
