import { expect, it } from "vite-plus/test";
import { surroundingAgent } from "#engine";
import { EngineRuntime, EngineApplicationError, getPrimitive } from "../src/engine/engine-runtime.js";
import { EngineMembrane } from "../src/engine/membrane.js";
import { createBrowserPlatform } from "../src/engine/browser-platform.js";

it("preserves Promise and queueMicrotask enqueue order", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate("var trace=[];Promise.resolve().then(()=>{trace.push('first');Promise.resolve().then(()=>trace.push('last'));});queueMicrotask(()=>trace.push('middle'));Promise.resolve().then(()=>trace.push('second'));");
    engine.timers.drainMicrotasks();
    expect(getPrimitive(engine.evaluate("trace.join(',')"))).toBe("first,middle,second,last");
  } finally { engine.dispose(); }
});

it("restores the surrounding agent after application exceptions", () => {
  const previous = surroundingAgent;
  const engine = new EngineRuntime();
  try {
    expect(() => engine.evaluate("throw 7")).toThrow(EngineApplicationError);
    expect(surroundingAgent).toBe(previous);
    expect(getPrimitive(engine.evaluate("1+2"))).toBe(3);
  } finally { engine.dispose(); }
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
  } finally { engine.dispose(); }
});

it("rejects unsupported timer delays rather than executing them early", () => {
  const engine = new EngineRuntime();
  try {
    expect(() => engine.evaluate("setTimeout(()=>{},5)")).toThrow("Delayed timers require a browser clock");
  } finally { engine.dispose(); }
});

it("bounds chained Promise jobs", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate("const again=()=>Promise.resolve().then(again);again();");
    expect(() => { engine.timers.drainMicrotasks(); engine.timers.drainMicrotasks(); }).toThrow("job budget exhausted");
  } finally { engine.dispose(); }
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
  } finally { engine.dispose(); }
});

it("preserves application throws across host callback round trips", () => {
  const engine = new EngineRuntime();
  try {
    const callback = engine.evaluate("()=>{throw 7}");
    engine.setGlobal("bridge", engine.createFunction("bridge", () => engine.call(callback, [])));
    expect(getPrimitive(engine.evaluate("try{bridge()}catch(error){error}"))).toBe(7);
  } finally { engine.dispose(); }
});

it("preserves DOM ownerDocument identity across the production boundary", async () => {
  const engine = new EngineRuntime();
  const browser = createBrowserPlatform(engine.timers);
  try {
    const membrane = new EngineMembrane(engine);
    engine.setGlobal("element", membrane.toEngine(browser.view.document.createElement("input")));
    engine.setGlobal("document", membrane.toEngine(browser.view.document));
    expect(getPrimitive(engine.evaluate("element.ownerDocument===document"))).toBe(true);
  } finally { engine.dispose(); await browser.dispose(); }
});

it("refuses callbacks after disposal", () => {
  const engine = new EngineRuntime();
  engine.dispose();
  expect(() => engine.evaluate("1")).toThrow("disposed");
});
