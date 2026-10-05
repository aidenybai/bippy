import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  runReconcilerProbe,
  type ReconcilerProbeOptions,
} from "../experiments/engine262/reconciler-probe.js";

it.each<Parameters<typeof runReconcilerProbe>[0]>(["native", "engine262"])(
  "reports uncaught microtask errors before disposing %s",
  async (backend) => {
    await expect(
      runReconcilerProbe(backend, {
        source: `queueMicrotask(() => { throw new Error("job boom"); }); export default () => <p>pending</p>;`,
      }),
    ).rejects.toThrow("job boom");
  },
  60_000,
);

it.each<Parameters<typeof runReconcilerProbe>[0]>(["native", "engine262"])(
  "preserves module failure messages before disposing %s",
  async (backend) => {
    await expect(
      runReconcilerProbe(backend, {
        source: 'throw new TypeError("module boom"); export default () => null;',
      }),
    ).rejects.toThrow("module boom");
  },
  60_000,
);

it("enforces the engine node quota while preparing React", async () => {
  await expect(
    runReconcilerProbe("engine262", {
      source: "export default () => <p>hello</p>;",
      maxNodes: 20,
    }),
  ).rejects.toThrow("node budget exhausted");
}, 60_000);

it("creates fresh React and application state for each engine run", async () => {
  const options = { source: "let renders = 0; export default () => <p>{++renders}</p>;" };
  const first = await runReconcilerProbe("engine262", options);
  const second = await runReconcilerProbe("engine262", options);
  expect(first.observation).toBe(second.observation);
  expect(first.observation).toContain('"text":"1"');
}, 60_000);

it("preserves special scalar observations rather than collapsing them through JSON", async () => {
  const options = {
    source: `export const getTrace = () => [undefined, null, NaN, -0, Infinity, -Infinity, 3n, "NaN"];
      export default () => <p data-negative={-0} data-infinity={Infinity} data-bigint={3n}>scalars</p>;`,
  };
  const native = await runReconcilerProbe("native", options);
  const engine = await runReconcilerProbe("engine262", options);
  expect(engine.observation).toBe(native.observation);
  expect(JSON.parse(engine.observation).mounted).toMatchObject({
    trace: [
      { $scalar: "undefined" },
      null,
      { $scalar: "NaN" },
      { $scalar: "-0" },
      { $scalar: "Infinity" },
      { $scalar: "-Infinity" },
      { $scalar: "bigint", value: "3" },
      "NaN",
    ],
    tree: [
      {
        props: {
          "data-negative": { $scalar: "-0" },
          "data-infinity": { $scalar: "Infinity" },
          "data-bigint": { $scalar: "bigint", value: "3" },
        },
      },
    ],
  });
}, 60_000);

it.each<Parameters<typeof runReconcilerProbe>[0]>(["native", "engine262"])(
  "rejects unsupported trace objects in %s",
  async (backend) => {
    await expect(
      runReconcilerProbe(backend, {
        source: 'export const getTrace = () => [{ $scalar: "NaN" }]; export default () => null;',
      }),
    ).rejects.toThrow("traces must contain only scalar values");
  },
  60_000,
);

it("reads trace accessors once per observation", async () => {
  const options = {
    source: `let reads = 0;
      export const getTrace = () => Object.defineProperty([0], "0", { get: () => ++reads });
      export default () => null;`,
  };
  const native = await runReconcilerProbe("native", options);
  const engine = await runReconcilerProbe("engine262", options);
  expect(engine.observation).toBe(native.observation);
  expect(JSON.parse(engine.observation)).toMatchObject({
    mounted: { trace: [1] },
    unmounted: { trace: [2] },
  });
}, 60_000);

interface ReconcilerCase extends ReconcilerProbeOptions {
  name: string;
  text: string;
  trace?: string[];
  caughtErrors?: string[];
}

const cases: ReconcilerCase[] = [
  {
    name: "context, reducer, memo and refs",
    text: "dark:2:true",
    source: `import { createContext, useContext, useReducer, useRef, memo, useMemo } from "react";
      const Context = createContext("light");
      const Child = memo(() => {
        const theme = useContext(Context);
        const [count, dispatch] = useReducer((count, delta) => count + delta, 0);
        const ref = useRef({});
        const saved = useMemo(() => ref.current, []);
        return <button onClick={() => dispatch(2)}>{theme + ":" + count + ":" + (ref.current === saved)}</button>;
      });
      export default () => <Context.Provider value="dark"><Child /></Context.Provider>;`,
    actions: [{ type: "button", event: "onClick" }],
  },
  {
    name: "keyed movement preserves host and component identities",
    text: "c:3",
    trace: ["mount:a", "mount:b", "mount:c", "unmount:a", "unmount:b", "unmount:c"],
    source: `import { useState, useEffect } from "react";
      const trace = []; let next = 0;
      export const getTrace = () => trace;
      const Item = ({ name }) => {
        const [id] = useState(() => ++next);
        useEffect(() => { trace.push("mount:" + name); return () => trace.push("unmount:" + name); }, []);
        return <li>{name + ":" + id}</li>;
      };
      export default () => {
        const [reverse, setReverse] = useState(false);
        return <button onClick={() => setReverse(value => !value)}>{(reverse ? ["c", "a", "b"] : ["a", "b", "c"]).map(name => <Item key={name} name={name} />)}</button>;
      };`,
    actions: [{ type: "button", event: "onClick" }],
  },
  {
    name: "error boundaries own caught failures",
    text: "caught:boom",
    caughtErrors: ["Error: boom"],
    trace: ["caught:boom"],
    source: `import { Component } from "react";
      const trace = []; export const getTrace = () => trace;
      class Boundary extends Component {
        state = { error: null };
        static getDerivedStateFromError(error) { return { error: error.message }; }
        componentDidCatch(error) { trace.push("caught:" + error.message); }
        render() { return this.state.error ? <p>{"caught:" + this.state.error}</p> : this.props.children; }
      }
      const Child = () => { throw new Error("boom"); };
      export default () => <Boundary><Child /></Boundary>;`,
  },
  {
    name: "external store subscriptions and cleanup",
    text: "7",
    trace: ["subscribe", "unsubscribe"],
    source: `import { useSyncExternalStore } from "react";
      const trace = []; const listeners = new Set(); let value = 1;
      export const getTrace = () => trace;
      const subscribe = callback => { trace.push("subscribe"); listeners.add(callback); return () => { trace.push("unsubscribe"); listeners.delete(callback); }; };
      const getSnapshot = () => value;
      export default () => {
        const snapshot = useSyncExternalStore(subscribe, getSnapshot);
        return <button onClick={() => { value = 7; listeners.forEach(listener => listener()); }}>{snapshot}</button>;
      };`,
    actions: [{ type: "button", event: "onClick" }],
  },
  {
    name: "transitions and deferred values settle",
    text: "updated:updated:false",
    source: `import { useState, useTransition, useDeferredValue } from "react";
      export default () => {
        const [value, setValue] = useState("initial");
        const [pending, start] = useTransition();
        const deferred = useDeferredValue(value);
        return <button onClick={() => start(() => setValue("updated"))}>{value + ":" + deferred + ":" + pending}</button>;
      };`,
    actions: [{ type: "button", event: "onClick" }],
  },
  {
    name: "suspended attempts do not install effects",
    text: "ready",
    trace: ["content:effect", "content:cleanup"],
    source: `import { Suspense, useEffect } from "react";
      const trace = []; export const getTrace = () => trace;
      let ready = false; const promise = new Promise(resolve => setTimeout(() => { ready = true; resolve(); }, 5));
      const Content = () => {
        useEffect(() => { trace.push("content:effect"); return () => trace.push("content:cleanup"); }, []);
        if (!ready) throw promise;
        return <p>ready</p>;
      };
      export default () => <Suspense fallback={<p>loading</p>}><Content /></Suspense>;`,
  },
  {
    name: "promise use resumes through engine jobs",
    text: "resolved",
    source: `import { Suspense, use } from "react";
      const promise = new Promise(resolve => setTimeout(() => resolve("resolved"), 5));
      const Content = () => <p>{use(promise)}</p>;
      export default () => <Suspense fallback={<p>loading</p>}><Content /></Suspense>;`,
  },
  {
    name: "callback ref cleanup",
    text: "attached",
    trace: ["ref:p", "ref:cleanup"],
    source: `const trace = []; export const getTrace = () => trace;
      const ref = instance => { trace.push("ref:" + instance.type); return () => trace.push("ref:cleanup"); };
      export default () => <p ref={ref}>attached</p>;`,
  },
  {
    name: "insertion, layout and passive effect order",
    text: "effects",
    trace: ["insert", "layout", "passive", "insert:cleanup", "layout:cleanup", "passive:cleanup"],
    source: `import { useInsertionEffect, useLayoutEffect, useEffect } from "react";
      const trace = []; export const getTrace = () => trace;
      export default () => {
        useInsertionEffect(() => { trace.push("insert"); return () => trace.push("insert:cleanup"); }, []);
        useLayoutEffect(() => { trace.push("layout"); return () => trace.push("layout:cleanup"); }, []);
        useEffect(() => { trace.push("passive"); return () => trace.push("passive:cleanup"); }, []);
        return <p>effects</p>;
      };`,
  },
  {
    name: "render-phase state updates",
    text: "3",
    source: `import { useState } from "react";
      export default () => { const [count, setCount] = useState(0); if (count < 3) setCount(count + 1); return <p>{count}</p>; };`,
  },
];

it.each(cases)(
  "matches engine-owned React: $name",
  async (testCase) => {
    const native = await runReconcilerProbe("native", testCase);
    const engine = await runReconcilerProbe("engine262", testCase);
    expect(engine.observation).toBe(native.observation);
    expect(engine.engineOwnedFunctions).toBe(4);
    const observed = JSON.parse(engine.observation);
    expect(JSON.stringify(observed.mounted.tree)).toContain(JSON.stringify(testCase.text));
    expect(observed.mounted.errors).toEqual([]);
    expect(observed.mounted.caughtErrors).toEqual(testCase.caughtErrors ?? []);
    expect(observed.unmounted.errors).toEqual([]);
    if (testCase.trace)
      expect(observed.unmounted.trace).toEqual(expect.arrayContaining(testCase.trace));
  },
  60_000,
);

it("runs React and its reconciler inside the engine for hook updates and cleanup", async () => {
  const options = {
    source: `import { useState, useEffect, useLayoutEffect } from "react";
      const trace = [];
      export const getTrace = () => trace;
      export default () => {
        const [count, setCount] = useState(0);
        useLayoutEffect(() => { trace.push("layout:" + count); return () => trace.push("layout-cleanup:" + count); }, [count]);
        useEffect(() => { trace.push("effect:" + count); return () => trace.push("cleanup:" + count); }, [count]);
        return <button onClick={() => setCount(previous => previous + 1)}>{count}</button>;
      };`,
    actions: [{ type: "button", event: "onClick" }],
  };
  const native = await runReconcilerProbe("native", options);
  const engine = await runReconcilerProbe("engine262", options);
  expect(engine.observation).toBe(native.observation);
  expect(engine.engineOwnedFunctions).toBe(4);
  expect(engine.metrics?.nodes).toBeGreaterThan(1000);
  expect(JSON.parse(engine.observation)).toMatchObject({
    mounted: { tree: [{ type: "button", children: [{ text: "1" }] }], errors: [] },
    unmounted: {
      tree: [],
      trace: [
        "layout:0",
        "effect:0",
        "layout-cleanup:0",
        "layout:1",
        "cleanup:0",
        "effect:1",
        "layout-cleanup:1",
        "cleanup:1",
      ],
    },
  });
}, 60_000);

it("executes class lifecycle methods, private fields and updater callbacks inside React", async () => {
  const options = {
    source: readFileSync(
      resolve(import.meta.dirname, "../experiments/engine262/fixtures/class-lifecycle.tsx"),
      "utf8",
    ),
    actions: [{ type: "button", event: "onClick" }],
  };
  const native = await runReconcilerProbe("native", options);
  const engine = await runReconcilerProbe("engine262", options);
  expect(engine.observation).toBe(native.observation);
  expect(engine.engineOwnedFunctions).toBe(4);
  expect(JSON.parse(engine.observation)).toMatchObject({
    mounted: {
      errors: [],
      trace: expect.arrayContaining(["mount:provided:private", "snapshot:1", "update:from:1:2"]),
    },
    unmounted: { trace: expect.arrayContaining(["unmount:private:2"]) },
  });
}, 60_000);
