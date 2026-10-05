import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  EngineRuntime,
  EngineApplicationError,
  getPrimitive,
} from "../src/engine/engine-runtime.js";
import {
  runProbe,
  type HostSnapshot,
  type ProbeInteraction,
} from "../experiments/engine262/probe.js";
import { EngineReactBridge } from "../experiments/engine262/react-bridge.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";
import { surroundingAgent } from "#engine";

const fixtures = resolve(import.meta.dirname, "../experiments/engine262/fixtures");
interface FixtureExpectation {
  name: string;
  text: string;
  trace: string[];
  interactions?: ProbeInteraction[];
}
const expectations: FixtureExpectation[] = [
  { name: "async-counter", text: "5:3", trace: ["effect:2", "timer", "promise:3", "cleanup:3"] },
  {
    name: "async-await",
    text: "3:expected",
    trace: ["before", "timer", "caught:expected", "finally", "cleanup:3"],
  },
  { name: "loop-cleanup", text: "0,1,2:body", trace: ["next", "body:7", "close"] },
  { name: "bigint", text: "true:9:3", trace: [] },
  {
    name: "hook-identity",
    text: "count:1:true:2",
    trace: ["effect:0", "cleanup:0", "effect:1", "cleanup:1"],
  },
  { name: "descriptors", text: "mutated:label,value", trace: ["receiver"] },
  { name: "nested-components", text: "nested", trace: ["child:mount", "child:cleanup"] },
  { name: "prop-identity", text: "true:true:3:true:true:truechild", trace: ["child:2", "child:3"] },
  { name: "context-reducer", text: "5:true", trace: ["init:2"] },
  { name: "memo-children", text: "true:2stable", trace: ["child:render"] },
  { name: "external-store", text: "7", trace: ["subscribe", "unsubscribe"] },
  { name: "bundled-modules", text: "3", trace: [] },
  {
    name: "class-lifecycle",
    text: "counter:2:private",
    interactions: [{ selector: "button", type: "click" }],
    trace: [
      "construct:counter",
      "derive:0",
      "render:0",
      "mount:provided:private",
      "derive:1",
      "should:1",
      "render:1",
      "snapshot:0",
      "update:from:0:1",
      "callback:1",
      "derive:2",
      "should:2",
      "render:2",
      "snapshot:1",
      "update:from:1:2",
      "unmount:private:2",
    ],
  },
  {
    name: "lazy-suspense",
    text: "ready",
    trace: [
      "load",
      "fallback:effect",
      "module",
      "data",
      "content:layout",
      "fallback:cleanup",
      "content:cleanup",
    ],
  },
  {
    name: "input-event",
    text: "hello",
    trace: ["change:true:hello"],
    interactions: [{ selector: "input", type: "input", value: "hello" }],
  },
  {
    name: "events-refs",
    text: "readready",
    trace: ["layout", "click:BUTTON:true", "after:true:BUTTON", "cleanup"],
    interactions: [{ selector: "button", type: "click" }],
  },
];
const getText = (nodes: HostSnapshot[]): string =>
  nodes
    .map(
      (node) =>
        (node.text ??
          (typeof node.props.children === "string" || typeof node.props.children === "number"
            ? String(node.props.children)
            : "")) + getText(node.children),
    )
    .join("");

it.each(expectations)(
  "matches native commits and cleanup traces: $name",
  async ({ name, text, trace, interactions }) => {
    const filePath = resolve(fixtures, `${name}.tsx`);
    const native = await runProbe({ backend: "native", filePath, interactions });
    const engine = await runProbe({ backend: "engine262", filePath, interactions });
    expect(native.errors).toEqual([]);
    expect(native.hasPendingWork).toBe(false);
    expect(getText(native.commits.at(-1) ?? [])).toBe(text);
    expect(native.trace).toEqual(trace);
    expect(engine.errors).toEqual([]);
    expect(engine.hasPendingWork).toBe(false);
    expect(engine.commits).toEqual(native.commits);
    expect(engine.trace).toEqual(native.trace);
    expect(engine.interactions).toEqual(native.interactions);
    expect(engine.unsupported).toEqual([]);
    expect(engine.metrics?.nodes).toBeGreaterThan(0);
  },
);

it("keeps concrete input assignments and fresh realms separate", async () => {
  const filePath = resolve(fixtures, "async-counter.tsx");
  for (const enabled of [false, true, false]) {
    const native = await runProbe({ backend: "native", filePath, props: { enabled } });
    const engine = await runProbe({ backend: "engine262", filePath, props: { enabled } });
    expect(engine.errors).toEqual([]);
    expect(engine.commits).toEqual(native.commits);
    expect(engine.trace).toEqual(native.trace);
  }
});

it("preserves Promise and queueMicrotask enqueue order", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate(
      "var trace=[];Promise.resolve().then(()=>{trace.push('first');Promise.resolve().then(()=>trace.push('last'));});queueMicrotask(()=>trace.push('middle'));Promise.resolve().then(()=>trace.push('second'));",
    );
    engine.timers.drainMicrotasks();
    expect(getPrimitive(engine.evaluate("trace.join(',')"))).toBe("first,middle,second,last");
  } finally {
    engine.dispose();
  }
});

it("restores the surrounding agent after application exceptions", () => {
  const previous = surroundingAgent;
  const engine = new EngineRuntime();
  try {
    expect(() => engine.evaluate("throw 7")).toThrow(EngineApplicationError);
    expect(surroundingAgent).toBe(previous);
    expect(getPrimitive(engine.evaluate("1+2"))).toBe(3);
  } finally {
    engine.dispose();
  }
});

it("rejects invalid node budgets without changing the surrounding agent", () => {
  const previous = surroundingAgent;
  for (const budget of [0, -1, Number.NaN, Infinity, 1.5])
    expect(() => new EngineRuntime(budget)).toThrow("positive safe integer");
  expect(surroundingAgent).toBe(previous);
});

it("bounds interpreted execution and refuses to reuse a failed agent", () => {
  const previous = surroundingAgent;
  const engine = new EngineRuntime(100);
  try {
    expect(() => engine.evaluate("while(true){};")).toThrow("node budget exhausted");
    expect(surroundingAgent).toBe(previous);
    expect(() => engine.evaluate("1")).toThrow();
  } finally {
    engine.dispose();
  }
});

it("rejects unsupported timer delays rather than executing them early", () => {
  const engine = new EngineRuntime();
  try {
    expect(() => engine.evaluate("setTimeout(()=>{},5)")).toThrow(
      "Delayed timers require a browser clock",
    );
  } finally {
    engine.dispose();
  }
});

it("bounds chained Promise jobs", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate("const again=()=>Promise.resolve().then(again);again();");
    expect(() => {
      engine.timers.drainMicrotasks();
      engine.timers.drainMicrotasks();
    }).toThrow("job budget exhausted");
  } finally {
    engine.dispose();
  }
});

it("reports Promise rejections and removes handled ones", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate("var rejected=Promise.reject('bad');");
    expect(engine.unhandledRejections.size).toBe(1);
    engine.evaluate("rejected.catch(()=>{});");
    engine.timers.drainMicrotasks();
    expect(engine.unhandledRejections.size).toBe(0);
    engine.evaluate("Promise.resolve().then(()=>{throw 'later';});");
    engine.timers.drainMicrotasks();
    expect(engine.unhandledRejections.size).toBe(1);
  } finally {
    engine.dispose();
  }
});

it("preserves application throws across host callback round trips", () => {
  const engine = new EngineRuntime();
  try {
    const callback = engine.evaluate("()=>{throw 7}");
    engine.setGlobal(
      "bridge",
      engine.createFunction("bridge", () => engine.call(callback, [])),
    );
    expect(getPrimitive(engine.evaluate("try{bridge()}catch(error){error}"))).toBe(7);
  } finally {
    engine.dispose();
  }
});

it("uses React's own element construction and preserves callback props", async () => {
  const engine = new EngineRuntime();
  try {
    new EngineReactBridge(engine, (await loadReactRuntime()).react);
    expect(
      getPrimitive(
        engine.evaluate(
          "const callback=()=>{};const element=__engineReact.createElement('button',{onClick:callback},'click');__engineReact.isValidElement(element)&&element.props.onClick===callback&&Object.isFrozen(element.props)",
        ),
      ),
    ).toBe(true);
  } finally {
    engine.dispose();
  }
});

it.each([
  "closure-identity.tsx",
  "context-provider-override.tsx",
  "context-recursion-dependencies.tsx",
  "context-recursion-updates.tsx",
  "context-scopes.tsx",
  "cross-component-effect-phases.tsx",
  "compiled-async.js",
  "compiled-automatic.js",
  "compiled-tslib-async.js",
  "compiled-rolldown-interop.js",
  "react-children.tsx",
  "prototype-chain.tsx",
  "promises.tsx",
  "feature-detection.tsx",
  "emotion-cache.tsx",
  "emotion-with-cache.tsx",
  "property-effects-proxy-identity.tsx",
  "compiled-classes.js",
  "compiled-babel6.js",
  "constructor-function-components.js",
  "compiled-uncontrolled.js",
  "element-type-statics.tsx",
  "string-substr.tsx",
  "intl-locales.tsx",
  "i18next-library.tsx",
  "lingui.tsx",
  "class-identity-fields.tsx",
  "suspending-data.tsx",
  "binary-data.tsx",
  "deepmerge-theme.tsx",
  "structured-data.tsx",
  "web-crypto.tsx",
  "effect-chains.tsx",
  "hook-form.tsx",
  "compiled-react-compiler.js",
  "forms.tsx",
  "error-boundaries.tsx",
  "error-boundary-correlation.tsx",
  "error-boundary-payload.tsx",
  "reducer-throw-phase.tsx",
  "class-results-error.tsx",
])("matches an existing component fixture: %s", async (file) => {
  const filePath = resolve(import.meta.dirname, "components", file);
  const native = await runProbe({ backend: "native", filePath });
  const engine = await runProbe({ backend: "engine262", filePath });
  expect(native.errors).toEqual([]);
  expect(engine.errors).toEqual([]);
  expect(engine.unsupported).toEqual([]);
  expect(native.hasPendingWork).toBe(false);
  expect(engine.hasPendingWork).toBe(false);
  expect(engine.commits).toEqual(native.commits);
  expect(engine.caughtErrors).toEqual(native.caughtErrors);
});

it("preserves DOM ownerDocument identity across the boundary", async () => {
  const engine = new EngineRuntime();
  try {
    const bridge = new EngineReactBridge(engine, (await loadReactRuntime()).react);
    engine.setGlobal("element", bridge.membrane.toEngine(document.createElement("input")));
    engine.setGlobal("document", bridge.membrane.toEngine(document));
    expect(getPrimitive(engine.evaluate("element.ownerDocument===document"))).toBe(true);
  } finally {
    engine.dispose();
  }
});

it("matches fresh browser state, cloned aliases, binary data, mocked fetch, and virtual deadlines", async () => {
  const options = {
    filePath: resolve(fixtures, "browser-platform.tsx"),
    responses: {
      "https://bippy.invalid/payload": {
        body: '{"name":"loaded"}',
        headers: { "content-type": "application/json" },
      },
    },
  };
  const native = await runProbe({ ...options, backend: "native" });
  const engine = await runProbe({ ...options, backend: "engine262" });
  expect(native.errors).toEqual([]);
  expect(engine.errors).toEqual([]);
  expect(engine.commits).toEqual(native.commits);
  expect(engine.trace).toEqual(native.trace);
  expect(getText(engine.commits.at(-1) ?? [])).toBe("loaded:stored");
  expect(engine.trace).toContain("true:true:live");
  expect(engine.trace).toContain("original:true:true");
  expect(engine.trace).toContain("héllo:true:7");
  expect(engine.trace).toContain("timer:1700000000005:5");
  expect(engine.trace).toContain("frame:16");
  expect(engine.trace).not.toContain("cancelled");
});

it("finishes the native Web Crypto work rather than comparing only the loading commit", async () => {
  const result = await runProbe({
    backend: "engine262",
    filePath: resolve(import.meta.dirname, "components/web-crypto.tsx"),
  });
  expect(result.errors).toEqual([]);
  const text = getText(result.commits.at(-1) ?? []);
  expect(text).toContain("secret message");
  expect(text).toContain("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  expect(text).toContain("30 bytes");
});

it("refuses callbacks after disposal", () => {
  const engine = new EngineRuntime();
  engine.dispose();
  expect(() => engine.evaluate("1")).toThrow("disposed");
});
