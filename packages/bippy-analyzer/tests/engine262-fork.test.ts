import { expect, it } from "vite-plus/test";
import * as pinned from "@engine262/engine262";
import { EngineRuntime, getPrimitive } from "../src/engine/engine-runtime.js";

interface ForkCase {
  name: string;
  body: string;
}

const cases: ForkCase[] = [
  {
    name: "per-iteration environments",
    body: "const callbacks=[]; for(let index=0;index<3;index++) callbacks.push(()=>index); return callbacks.map(callback=>callback());",
  },
  {
    name: "captured mutation and finally",
    body: "const object={count:0}; const run=()=>{ try { object.count++; throw object; } finally { object.count+=2; } }; try {run();}catch(error){return [error===object,object.count];}",
  },
  {
    name: "iterator closing preserves the original throw",
    body: "let closed=false; const iterable={ [Symbol.iterator](){return {next(){return {value:1,done:false};},return(){closed=true;throw 2;}};}}; try {for(const value of iterable){throw value;}}catch(error){return [error,closed];}",
  },
  {
    name: "descriptor flags and accessor receiver",
    body: "const parent={get value(){return this.count;}}; const child=Object.create(parent); Object.defineProperty(child,'count',{value:4}); return [child.value,Object.getOwnPropertyDescriptor(child,'count'),Reflect.set(child,'count',8)];",
  },
  {
    name: "private fields and derived constructors",
    body: "class Parent {constructor(value){this.value=value;}} class Child extends Parent {#count=2;read(){return this.value+this.#count;}} return new Child(5).read();",
  },
  {
    name: "bound construction and new.target",
    body: "function Parent(value){this.value=value;this.direct=new.target===Parent;} const Bound=Parent.bind(null,4); const instance=new Bound(); return [instance.value,instance.direct,instance instanceof Parent];",
  },
  {
    name: "generator completions",
    body: "function* values(){try {yield 1;return 2;}finally {yield 3;}} const iterator=values();return [iterator.next(),iterator.return(7),iterator.next()];",
  },
  {
    name: "bigint updates and exponentiation",
    body: "let value=2n; const previous=value++;return [String(previous),String(value**3n),String(-value)];",
  },
  {
    name: "proxy invariants",
    body: "const target=Object.freeze({value:1});const proxy=new Proxy(target,{get(){return 2;}});try {return proxy.value;}catch(error){return error.name;}",
  },
  {
    name: "sparse arrays and enumeration",
    body: "const items=[,1,,3];items.named=4;return [items.length,Object.keys(items),0 in items,items.map(value=>value*2)];",
  },
  {
    name: "map keys and negative zero",
    body: "const map=new Map([[NaN,1],[-0,2]]);return [map.get(NaN),map.get(0),Object.is([...map.keys()][1],0),Object.is(-0,0)];",
  },
  {
    name: "non-Unicode identity escapes",
    body: String.raw`return [new RegExp('\\q').test('q'),new RegExp('a{').test('a{'),new RegExp(']').test(']'),new RegExp('a{2}').test('aa')];`,
  },
  {
    name: "invalid Unicode regular expression",
    body: String.raw`try {new RegExp('\\q','u');return false;}catch(error){return error.name;}`,
  },
  {
    name: "function parameter scope",
    body: "let value=7;const read=(callback=()=>value)=>{var value=9;return callback();};return read();",
  },
  {
    name: "switch lexical scope",
    body: "let value=1; try {switch(value){case value:let value=2;return value;}}catch(error){return error.name;}",
  },
];

const evaluatePinned = (source: string): unknown => {
  const previous = pinned.surroundingAgent;
  pinned.setSurroundingAgent(new pinned.Agent({ startEventLoop: false }));
  try {
    const realm = new pinned.ManagedRealm();
    const result = realm.evaluateScriptSkipDebugger(source);
    if (result instanceof pinned.ThrowCompletion) throw new Error("Pinned engine probe threw");
    const value = result instanceof pinned.NormalCompletion ? result.Value : result;
    return value instanceof pinned.JSStringValue ? value.stringValue() : undefined;
  } finally {
    pinned.setSurroundingAgent(previous);
  }
};

it.each(cases)("fork matches pinned engine and native JavaScript: $name", ({ body }) => {
  const source = `JSON.stringify((() => { "use strict"; ${body} })())`;
  const native: unknown = new Function(`return ${source}`)();
  const engine = new EngineRuntime();
  try {
    expect(getPrimitive(engine.evaluate(source))).toBe(native);
    expect(evaluatePinned(source)).toBe(native);
  } finally {
    engine.dispose();
  }
});
