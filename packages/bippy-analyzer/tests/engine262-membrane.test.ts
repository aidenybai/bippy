import { describe, expect, it } from "vite-plus/test";
import {
  EngineRuntime,
  EngineApplicationError,
  getPrimitive,
} from "../src/engine/engine-runtime.js";
import { EngineMembrane } from "../src/engine/membrane.js";
import { installCompatibility } from "../src/engine/compatibility.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import { VirtualClock } from "../src/engine/virtual-clock.js";

interface Receiver {
  label: string;
  marker: string;
}
interface BoundaryCase {
  name: string;
  source: string;
  createHost: () => unknown;
}
const cases: BoundaryCase[] = [
  {
    name: "cycles and aliases",
    createHost: () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return { first: value, second: value };
    },
    source: "return host.first===host.second&&host.first.self===host.first",
  },
  {
    name: "frozen descriptors",
    createHost: () => Object.freeze({ value: Object.freeze({ count: 3 }) }),
    source:
      "const descriptor=Object.getOwnPropertyDescriptor(host,'value');return Object.isFrozen(host)&&Object.isFrozen(host.value)&&descriptor.value===host.value&&!descriptor.writable&&!descriptor.configurable",
  },
  {
    name: "nonextensible arrays",
    createHost: () => Object.preventExtensions([1, 2]),
    source:
      "host[0]=3;return Array.isArray(host)&&Object.keys(host).join(',')==='0,1'&&!Object.isExtensible(host)&&host[0]===3",
  },
  {
    name: "borrowed getter receiver",
    createHost: (): Receiver => ({
      get label() {
        return this.marker;
      },
      marker: "host",
    }),
    source:
      "const receiver=Object.create(host);receiver.marker='engine';return receiver.label==='engine'&&Reflect.get(host,'label',receiver)==='engine'",
  },
  {
    name: "prototype reflection",
    createHost: () => Object.create({ inherited: 7 }),
    source:
      "return host.inherited===7&&Object.getPrototypeOf(host).inherited===7&&host instanceof Object",
  },
  {
    name: "construction and subclass fields",
    createHost: () =>
      class Counter {
        constructor(readonly count: number) {}
        read() {
          return this.count;
        }
      },
    source:
      "class Child extends host{#secret=2;read(){return super.read()+this.#secret}}const value=new Child(3);return value instanceof host&&value instanceof Child&&value.read()===5",
  },
  {
    name: "native errors remain catchable",
    createHost: () => () => {
      throw new TypeError("native");
    },
    source:
      "try{host()}catch(error){return error instanceof TypeError&&error.constructor===TypeError&&error.message==='native'}",
  },
  {
    name: "thrown object round trips",
    createHost: () => (callback: () => unknown) => callback(),
    source:
      "const sentinel={};try{host(()=>{throw sentinel})}catch(error){return error===sentinel}",
  },
  {
    name: "well-known and registered symbols",
    createHost: () => ({ [Symbol.for("shared")]: Symbol.iterator, symbol: Symbol("local") }),
    source:
      "return host[Symbol.for('shared')]===Symbol.iterator&&host.symbol===host.symbol&&Reflect.ownKeys(host).includes(Symbol.for('shared'))",
  },
  {
    name: "native functions cannot select the host Function constructor",
    createHost: () => () => {},
    source: "return host.constructor===Function&&host.constructor('return Array')()===Array",
  },
  {
    name: "engine arrays remain arrays in native calls",
    createHost: () => (value: unknown) => Array.isArray(value),
    source: "return host([1,2])",
  },
  {
    name: "native writes retain engine identity",
    createHost: () => (object: Record<string, unknown>, value: unknown) => {
      object.value = value;
    },
    source: "const object={},value={};host(object,value);return object.value===value",
  },
  {
    name: "frozen engine properties preserve descriptors",
    createHost: () => (value: object) =>
      Object.isFrozen(value) &&
      Reflect.getOwnPropertyDescriptor(value, "child")?.value === Reflect.get(value, "child"),
    source: "return host(Object.freeze({child:{}}))",
  },
  {
    name: "foreign getter definitions",
    createHost: () => (value: object, getter: () => unknown) =>
      Object.defineProperty(value, "value", { get: getter, enumerable: true }),
    source:
      "const object={marker:7};host(object,function(){return this.marker});return object.value===7&&Object.keys(object).join(',')==='marker,value'",
  },
  {
    name: "prototype mutation",
    createHost: () => (value: object, prototype: object) =>
      Reflect.setPrototypeOf(value, prototype),
    source:
      "const object={},prototype={value:3};return host(object,prototype)&&Object.getPrototypeOf(object)===prototype&&object.value===3",
  },
  {
    name: "host prevention of extensions",
    createHost: () => (value: object) => Object.preventExtensions(value),
    source: "const object={};return host(object)===object&&!Object.isExtensible(object)",
  },
  {
    name: "host deletion after descriptor synchronization",
    createHost: () => {
      const value = Object.preventExtensions({ value: 3 });
      return {
        value,
        remove: () => {
          Reflect.deleteProperty(value, "value");
        },
      };
    },
    source:
      "Object.getOwnPropertyDescriptor(host.value,'value');host.remove();return !Object.hasOwn(host.value,'value')&&Reflect.ownKeys(host.value).length===0",
  },
  {
    name: "special scalar identity",
    createHost: () => (value: unknown) => value,
    source: "return Object.is(host(-0),-0)&&Object.is(host(NaN),NaN)&&host(3n)===3n",
  },
];

describe("engine262 object boundary", () => {
  it.each(cases)("$name", ({ source, createHost }) => {
    const expected = new Function("host", source)(createHost());
    expect(expected).toBe(true);
    const engine = new EngineRuntime();
    try {
      const membrane = new EngineMembrane(engine);
      engine.setGlobal("host", membrane.toEngine(createHost()));
      expect(getPrimitive(engine.evaluate(`(()=>{${source}})()`))).toBe(expected);
    } finally {
      engine.dispose();
    }
  });

  it.each([
    "get",
    "set",
    "has",
    "ownKeys",
    "getOwnPropertyDescriptor",
    "defineProperty",
    "deleteProperty",
    "getPrototypeOf",
    "setPrototypeOf",
    "isExtensible",
    "preventExtensions",
  ])("preserves an application throw from the %s trap", (trap) => {
    const engine = new EngineRuntime();
    try {
      const membrane = new EngineMembrane(engine);
      const operations: Record<string, (value: object) => unknown> = {
        get: (value) => Reflect.get(value, "key"),
        set: (value) => Reflect.set(value, "key", 1),
        has: (value) => Reflect.has(value, "key"),
        ownKeys: Reflect.ownKeys,
        getOwnPropertyDescriptor: (value) => Reflect.getOwnPropertyDescriptor(value, "key"),
        defineProperty: (value) => Reflect.defineProperty(value, "key", { value: 1 }),
        deleteProperty: (value) => Reflect.deleteProperty(value, "key"),
        getPrototypeOf: Reflect.getPrototypeOf,
        setPrototypeOf: (value) => Reflect.setPrototypeOf(value, null),
        isExtensible: Reflect.isExtensible,
        preventExtensions: Reflect.preventExtensions,
      };
      engine.setGlobal("host", membrane.toEngine(operations[trap]));
      expect(
        getPrimitive(
          engine.evaluate(
            `(()=>{const sentinel={};const value=new Proxy({}, {${trap}(){throw sentinel}});try{host(value)}catch(error){return error===sentinel}})()`,
          ),
        ),
      ).toBe(true);
    } finally {
      engine.dispose();
    }
  });
});

it.each(
  [
    "{",
    "}",
    "]",
    "a{",
    "a{2",
    "a{2,",
    "a{,2}",
    "a{2,1}",
    "{2}",
    "a{2}",
    "a{1,2}",
    "[{}]",
    "\\q",
    "\\a",
    "\\z",
  ].flatMap((pattern) => ["", "u", "v"].map((flags) => ({ pattern, flags }))),
)("matches native legacy regex parsing: $pattern / $flags", ({ pattern, flags }) => {
  const engine = new EngineRuntime();
  const source = `(()=>{try{return JSON.stringify(new RegExp(${JSON.stringify(pattern)},${JSON.stringify(flags)}).exec('aaa{}]qaz'))}catch(error){return error.name}})()`;
  try {
    expect(getPrimitive(engine.evaluate(source))).toBe(new Function(`return ${source}`)());
  } finally {
    engine.dispose();
  }
});

it.each([
  "const copy=structuredClone(new Map([['key',3]]));return copy instanceof Map&&Map.prototype.get.call(copy,'key')===3",
  "const copy=structuredClone(new Set([3]));return copy instanceof Set&&Set.prototype.has.call(copy,3)",
  "const copy=structuredClone(/a+/g);return copy instanceof RegExp&&RegExp.prototype.test.call(copy,'aaa')",
  "const copy=structuredClone(Object(-0));return copy instanceof Number&&Object.is(Number.prototype.valueOf.call(copy),-0)",
  "const copy=structuredClone(new TypeError('message',{cause:{value:3}}));return copy instanceof TypeError&&copy.message==='message'&&copy.cause.value===3",
  "return Map.prototype.entries===Map.prototype[Symbol.iterator]&&Set.prototype.values===Set.prototype[Symbol.iterator]",
  "const source={};source.self=source;const copy=structuredClone(source);return copy!==source&&copy.self===copy",
  "const shared={};const copy=structuredClone(new Map([[shared,new Set([shared])]]));const key=[...copy.keys()][0];return copy.get(key).has(key)",
  "const source=[];source.length=4;source[2]=7;const copy=structuredClone(source);return copy.length===4&&!(0 in copy)&&copy[2]===7",
  "let reads=0;const copy=structuredClone({get value(){reads++;return 3}});return reads===1&&copy.value===3",
  "const source=new Uint8Array([1,2]);const copy=structuredClone(source,{transfer:[source.buffer]});return source.byteLength===0&&copy[1]===2",
  "let reads=0;try{structuredClone({value:Symbol(),get later(){reads++;return 1}})}catch(error){return error.name==='DataCloneError'&&reads===0}",
  "const value=new Proxy({},{});try{structuredClone(value)}catch(error){return error.name==='DataCloneError'}",
  "return (12345).toLocaleString('en-US')==='12,345'&&(12345n).toLocaleString('en-US')==='12,345'",
  "const options={};return structuredClone({value:3},options).value===3",
  "const bytes=new Uint8Array([1,2]);return ArrayBuffer.isView(bytes)&&bytes instanceof Uint8Array&&Object.prototype.toString.call(bytes)==='[object Uint8Array]'",
])("matches native boundary builtins: %s", (source) => {
  expect(new Function(source)()).toBe(true);
  const engine = new EngineRuntime();
  try {
    const membrane = new EngineMembrane(engine);
    installCompatibility(membrane);
    expect(getPrimitive(engine.evaluate(`(()=>{${source}})()`))).toBe(true);
  } catch (error) {
    if (error instanceof EngineApplicationError) throw new Error(engine.describeError(error));
    throw error;
  } finally {
    engine.dispose();
  }
});

it("cancels low-level engine timer handles by identity", () => {
  const engine = new EngineRuntime();
  try {
    engine.evaluate("let value=0;const handle=setTimeout(()=>value++,0);clearTimeout(handle)");
    while (engine.timers.hasTasks()) engine.timers.runNextTask();
    expect(getPrimitive(engine.evaluate("value"))).toBe(0);
  } finally {
    engine.dispose();
  }
});

it("interleaves engine jobs with native microtasks in enqueue order", async () => {
  const engine = new EngineRuntime(undefined, new TimerQueue(), true);
  const trace: unknown[] = [];
  try {
    engine.setGlobal(
      "record",
      engine.createFunction("record", ([value]) => {
        trace.push(getPrimitive(value));
        return engine.createPrimitive(undefined);
      }),
    );
    engine.evaluate(
      "Promise.resolve().then(()=>record('promise'));queueMicrotask(()=>record('microtask'))",
    );
    queueMicrotask(() => trace.push("native"));
    engine.evaluate("Promise.resolve().then(()=>record('last'))");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(trace).toEqual(["promise", "microtask", "native", "last"]);
    expect(engine.backgroundErrors).toEqual([]);
  } finally {
    engine.dispose();
  }
});

it("orders deadlines, cancels timers, preserves equal-deadline order, and clears intervals", () => {
  const tasks = new TimerQueue();
  const clock = new VirtualClock(tasks);
  const trace: string[] = [];
  clock.setTimeout(() => trace.push(`late:${clock.now}`), 10);
  const cancelled = clock.setTimeout(() => trace.push("cancelled"), 1);
  clock.clearTimeout(cancelled);
  clock.setTimeout(() => trace.push(`first:${clock.now}`), 5);
  clock.setTimeout(() => trace.push(`second:${clock.now}`), 5);
  let ticks = 0;
  const interval = clock.setInterval(() => {
    trace.push(`tick:${clock.now}`);
    if (++ticks === 2) clock.clearTimeout(interval);
  }, 2);
  for (let count = 0; tasks.hasTasks() && count < 20; count++) tasks.runNextTask();
  expect(tasks.hasTasks()).toBe(false);
  expect(trace).toEqual(["tick:2", "tick:4", "first:5", "second:5", "late:10"]);
});
