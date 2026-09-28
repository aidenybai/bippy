import { expect, it } from "vite-plus/test";
import { evaluateLowered } from "./helpers/control-fixture.js";

interface MachineCase {
  name: string;
  source: string;
}

const cases: MachineCase[] = [
  {
    name: "ordinary for-of closures and iterator closing",
    source:
      "const trace=[];function collect(values){const callbacks=[];for(const value of values){callbacks.push(()=>value);if(value===2)break;}return callbacks.map(callback=>callback());}function* values(){try{yield 1;yield 2;yield 3;}finally{trace.push('close');}}function* run(){yield collect(values());return trace;}const iterator=run();const result=[iterator.next(),iterator.next()];",
  },
  {
    name: "generator for-of captures across suspension",
    source:
      "function* run(){const callbacks=[];for(const value of [1,2]){callbacks.push(()=>value);yield value;}return callbacks.map(callback=>callback());}const iterator=run();const result=[iterator.next(),iterator.next(),iterator.next()];",
  },
  {
    name: "foreign delegates without prototype inspection",
    source:
      "const iterator=new Proxy({[Symbol.iterator](){return this;},next(){return {done:true,value:7};}},{getPrototypeOf(){throw new Error('Unexpected prototype inspection');}});function* run(){return yield* iterator;}const result=run().next();",
  },
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
