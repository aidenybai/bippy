import { expect, it } from "vite-plus/test";
import { measureSynchronousExecution } from "#engine";
import { evaluateLowered } from "./helpers/lowered-engine.js";
import { EngineRuntime, getPrimitive } from "../src/engine/engine-runtime.js";

interface MachineCase {
  name: string;
  source: string;
}

const cases: MachineCase[] = [
  {
    name: "resume values and updates",
    source:
      "function* run(value){value += yield value++;return value;}const iterator=run(2);const result=[iterator.next(99),iterator.next(4),iterator.next()];",
  },
  {
    name: "return through yielding finally",
    source:
      "function* run(){try{yield 1;return 2;}finally{yield 3;}}const iterator=run();const result=[iterator.next(),iterator.return(7),iterator.next(),iterator.return(0)];",
  },
  {
    name: "throw through catch and finally",
    source:
      "function* run(){try{yield 1;}catch(error){yield error;}finally{yield 3;}return 4;}const iterator=run();const result=[iterator.next(),iterator.throw(2),iterator.next(),iterator.next()];",
  },
  {
    name: "nested finally overrides return",
    source:
      "function* run(){try{try{yield 1;return 2;}finally{yield 3;return 4;}}finally{yield 5;}}const iterator=run();const result=[iterator.next(),iterator.next(),iterator.next(),iterator.next()];",
  },
  {
    name: "delegate receives return",
    source:
      "function* child(){try{yield 1;}finally{yield 2;}}function* run(){const value=yield* child();return value;}const iterator=run();const result=[iterator.next(),iterator.return(9),iterator.next(),iterator.next()];",
  },
  {
    name: "delegate handles throw",
    source:
      "function* child(){try{yield 1;}catch(error){return error;}}function* run(){return 1+(yield* child());}const iterator=run();const result=[iterator.next(),iterator.throw(6),iterator.next()];",
  },
  {
    name: "return before entry",
    source:
      "let entered=0;function* run(){try{entered++;yield 1;}finally{entered++;}}const iterator=run();const result=[iterator.return(4),iterator.next(),entered];",
  },
  {
    name: "throw before entry and after completion",
    source:
      "let entered=0;function* run(){try{entered++;yield 1;}finally{entered++;}}const iterator=run();const result=[];try{iterator.throw(4);}catch(error){result.push(error);}result.push(iterator.next(),entered);try{iterator.throw(5);}catch(error){result.push(error);}",
  },
  {
    name: "destructured parameters",
    source:
      "function* run({value},...rest){value+=yield rest[0];return value;}const iterator=run({value:3},4);const result=[iterator.next(),iterator.next(5)];",
  },
  {
    name: "default parameter captures",
    source:
      "function* run(value=1,read=()=>value){value=2;yield read();return ++value;}const iterator=run();const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "closed-over activation mutation",
    source:
      "function* run(){let value=1;const read=()=>value;yield read;value++;return read;}const iterator=run();const read=iterator.next().value;const last=iterator.next().value;const result=[read(),last(),read===last];",
  },
  {
    name: "per-iteration closures",
    source:
      "function* run(){const callbacks=[];for(let index=0;index<3;index++){callbacks.push(()=>index);yield index;}return callbacks.map(callback=>callback());}const iterator=run();const result=[iterator.next(),iterator.next(),iterator.next(),iterator.next()];",
  },
  {
    name: "conditional loop index reads",
    source:
      "function* run(){const values=[1,2,3];for(let index=0;index<values.length;index++){if(index>0)yield index+values[index];}}const result=[...run()];",
  },
  {
    name: "labeled continue and break run finally",
    source:
      "const trace=[];function* run(){outer:for(let index=0;index<3;index++){try{if(index===0)continue outer;if(index===2)break outer;yield index;}finally{trace.push(index);}}return trace;}const iterator=run();const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "object assignment and shorthand",
    source:
      "function* run(){let value=1;({value}={value:2});yield {value};value++;return {value};}const iterator=run();const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "arguments and receiver",
    source:
      "function* run(value){yield arguments[0];return this.value+value;}const iterator=run.call({value:2},3);const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "reentrant resume is rejected",
    source:
      "let iterator;function* run(){try{iterator.next();}catch(error){yield error.name;}return 1;}iterator=run();const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "missing delegate throw closes iterator",
    source:
      "let closed=0;function* run(){try{yield*{[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;return {};}};}catch(error){return [error.name,closed];}}const iterator=run();const result=[iterator.next(),iterator.throw(3)];",
  },
  {
    name: "non-object delegate result",
    source:
      "function* run(){try{yield*{[Symbol.iterator](){return this;},next(){return 1;}};}catch(error){return error.name;}}const result=run().next();",
  },
  {
    name: "overridden delegate next",
    source:
      "function* child(){yield 1;}function* run(){const iterator=child();iterator.next=()=>({value:5,done:true});return yield*iterator;}const result=run().next();",
  },
];

it.each(cases)("lowers engine control without changing $name", async ({ source }) => {
  const native: unknown = new Function(`"use strict";${source}\nreturn result;`)();
  expect(await evaluateLowered(source)).toEqual(native);
});

it("drives twenty thousand delegated frames without native recursion", async () => {
  expect(
    await evaluateLowered(
      "function* run(depth){if(!depth)return 0;return 1+(yield*run(depth-1));}const result=run(20000).next();",
    ),
  ).toEqual({ value: 20000, done: true });
}, 30_000);

it.each([
  { call: "visit(depth-1)", transfers: 1 },
  { call: "bound(depth-1)", transfers: 1 },
  { call: "visit.call(null,depth-1)", transfers: 2 },
  { call: "visit.apply(null,[depth-1])", transfers: 2 },
  { call: "Reflect.apply(visit,null,[depth-1])", transfers: 2 },
  { call: "proxied(depth-1)", transfers: 1 },
  { call: "trapped(depth-1)", transfers: 3 },
])(
  "keeps strict tail-call continuation depth bounded: $call",
  ({ call, transfers }) => {
    const engine = new EngineRuntime(1_000_000);
    try {
      const small = measureSynchronousExecution(() =>
        getPrimitive(
          engine.evaluate(
            `"use strict"; function visit(depth){return depth ? ${call} : 7;} const bound=visit.bind(null); const proxied=new Proxy(visit,{}); const trapped=new Proxy(visit,{apply(target,receiver,args){return Reflect.apply(target,receiver,args);}}); visit(10)`,
          ),
        ),
      );
      const large = measureSynchronousExecution(() => getPrimitive(engine.evaluate("visit(1000)")));
      expect(small.value).toBe(7);
      expect(large.value).toBe(7);
      expect(small.metrics.tailTransfers).toBe(10 * transfers);
      expect(large.metrics.tailTransfers).toBe(1000 * transfers);
      expect(large.metrics.peakFrames).toBeLessThanOrEqual(small.metrics.peakFrames + 4);
    } finally {
      engine.dispose();
    }
  },
  30_000,
);

const tailCases = [
  "function next(){return 3;}function run(){switch(0){default:case 0:return next();}}return run();",
  "function next(){return 2;} function base(){this.value=1;return next();} const result=new base();return result.value;",
  "const result={value:3};function next(){return result;}function base(){return next();}return new base()===result;",
  "class Base {} class Derived extends Base {constructor(){super();return (()=>undefined)();}} return new Derived() instanceof Derived;",
  "class Base {} class Derived extends Base {constructor(){super();return (()=>3)();}} try {new Derived();}catch(error){return error.name;}",
  "class Base {} class Derived extends Base {constructor(){return (()=>undefined)();}} try {new Derived();}catch(error){return error.name;}",
  "function next(){throw 3;}function run(){try {return next();}catch(error){return error+1;}}return run();",
  "const trace=[];function next(){trace.push('call');return 2;}function run(){try {return next();}finally {trace.push('finally');}}return [run(),trace];",
  "const trace=[];function next(){trace.push('call');return 2;}function run(){try {throw 1;}catch(error){trace.push(error);return next();}}return [run(),trace];",
  "const trace=[];function next(){trace.push('call');return 2;}function run(){try {throw 1;}finally {trace.push('finally');return next();}}return [run(),trace];",
  "const trace=[];function* values(){try{yield 1;}finally{trace.push('close');}}function next(){trace.push('call');return 2;}function run(){for(const value of values()){return next();}}return [run(),trace];",
  "function next(){return 4;}function run(){return 1+(true && next());}return run();",
  "function next(){return 4;}function run(){return next() && 2;}return run();",
  "function next(){return 4;}function run(){return true ? next() : 0;}return run();",
  "function next(){return 4;}function run(){return (0,next());}return run();",
  "function next(){return 4;}function run(){return (next(),2);}return run();",
  "function next(){return {value:4};}function run(){return next().value;}return run();",
  "const next=()=>4;const run=()=>next?.();return run();",
  "const object={value:4,next(){return this.value;}};const run=()=>object?.next();return run();",
  "function next(){return 4;}function* run(){return next();}return run().next();",
  "function next(){return 4;}function run(depth){return depth ? bound(depth-1) : next();}const bound=run.bind(null);return run(10);",
];

it.each(tailCases)("preserves tail-position effects and completions: %s", (body) => {
  const source = `(() => {"use strict";${body}})()`;
  const engine = new EngineRuntime();
  try {
    const expected: unknown = new Function(`return JSON.stringify(${source})`)();
    expect(getPrimitive(engine.evaluate(`JSON.stringify(${source})`))).toBe(expected);
  } finally {
    engine.dispose();
  }
});

it("does not bypass explicit resource disposal during a return", () => {
  const engine = new EngineRuntime();
  try {
    expect(
      getPrimitive(
        engine.evaluate(
          `"use strict"; const trace=[]; function next(){trace.push('call');return 3;}function run(){using resource = {[Symbol.dispose](){trace.push('dispose');}};return next();}JSON.stringify([run(),trace]);`,
        ),
      ),
    ).toBe('[3,["call","dispose"]]');
  } finally {
    engine.dispose();
  }
});

it("executes deeply recursive application calls in the same engine", () => {
  const engine = new EngineRuntime(1_000_000);
  try {
    expect(
      getPrimitive(
        engine.evaluate("function visit(depth){return depth ? 1+visit(depth-1) : 0;} visit(2000)"),
      ),
    ).toBe(2000);
  } finally {
    engine.dispose();
  }
}, 30_000);
