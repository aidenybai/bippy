import { expect, it } from "vite-plus/test";
import { runInNewContext } from "node:vm";
import { evaluateLowered } from "./helpers/control-fixture.js";

interface MachineCase {
  name: string;
  source: string;
}

const cases: MachineCase[] = [
  {
    name: "primitive iterable receiver and Unicode iteration",
    source:
      "const original=String.prototype[Symbol.iterator];const trace=[];Object.defineProperty(String.prototype,Symbol.iterator,{get(){trace.push(typeof this);return function(){trace.push(typeof this);return Reflect.apply(original,this,[]);};}});function* run(){yield*'a𝌆';}const result=[[...run()],trace];",
  },
  {
    name: "invalid primitive iterables and iterator results",
    source:
      "function* run(value){try{return yield*value;}catch(error){return error.name;}}const result=[null,undefined,7,Symbol('value'),{[Symbol.iterator](){return 7;}}].map(value=>run(value).next());",
  },
  {
    name: "next-only noniterable rejection",
    source:
      "function* run(){try{return yield*{next(){return {done:true,value:7};}};}catch(error){return error.name;}}const result=run().next();",
  },
  {
    name: "legacy iterator noniterable rejection",
    source:
      "function* run(){try{return yield*{'@@iterator'(){return {next(){return {done:true,value:7};}};}};}catch(error){return error.name;}}const result=run().next();",
  },
  {
    name: "array-like noniterable rejection",
    source:
      "function* run(){try{return yield*{0:7,length:1};}catch(error){return error.name;}}const result=run().next();",
  },
  {
    name: "noncallable iterator method rejection",
    source:
      "function* run(){try{return yield*{[Symbol.iterator]:{call(){return {next(){return {done:true,value:7};}};}}};}catch(error){return error.name;}}const result=run().next();",
  },
  {
    name: "iterator method call without consulting its call property",
    source:
      "const factory=()=>({next(){return {done:true,value:7};}});factory.call=()=>{throw Error('call property');};function* run(){try{return yield*{[Symbol.iterator]:factory};}catch(error){return error.message;}}const result=run().next();",
  },
  {
    name: "forwarded delegate result identity without reading value",
    source:
      "const prototype={marker:1};let reads=0;const yielded=Object.create(prototype,{done:{value:false,enumerable:true},value:{get(){reads++;throw Error('value');},enumerable:true},extra:{value:7,enumerable:true}});const delegate={[Symbol.iterator](){return this;},next(){return yielded;}};function* run(){return yield*delegate;}let result;try{const step=run().next();result=[step===yielded,Object.getPrototypeOf(step)===prototype,Reflect.ownKeys(step),reads];}catch(error){result=[error.message,reads];}",
  },
  {
    name: "forwarded delegate return result identity",
    source:
      "let reads=0;const yielded={done:false,get value(){reads++;throw Error('value');}};const delegate={[Symbol.iterator](){return this;},next(){return {done:false,value:1};},return(){return yielded;}};function* run(){return yield*delegate;}const iterator=run();iterator.next();let result;try{result=[iterator.return(7)===yielded,reads];}catch(error){result=[error.message,reads];}",
  },
  {
    name: "forwarded delegate throw result identity",
    source:
      "let reads=0;const yielded={done:false,get value(){reads++;throw Error('value');}};const delegate={[Symbol.iterator](){return this;},next(){return {done:false,value:1};},throw(){return yielded;}};function* run(){return yield*delegate;}const iterator=run();iterator.next();let result;try{result=[iterator.throw(7)===yielded,reads];}catch(error){result=[error.message,reads];}",
  },
  {
    name: "null delegate return method",
    source:
      "const delegate={[Symbol.iterator](){return this;},next(){return {done:false,value:1};},return:null};function* run(){return yield*delegate;}const iterator=run();iterator.next();let result;try{result=iterator.return(7);}catch(error){result=error.name;}",
  },
  {
    name: "null delegate throw with null closing method",
    source:
      "const trace=[];const delegate={[Symbol.iterator](){return this;},next(){return {done:false,value:1};},throw:null,get return(){trace.push('return');return null;}};function* run(){try{return yield*delegate;}catch(error){return error.name;}}const iterator=run();iterator.next();const result=[iterator.throw(7),trace];",
  },
  {
    name: "noncallable cached delegate next",
    source:
      "const trace=[];const delegate={[Symbol.iterator](){return this;},get next(){trace.push('next');return 17;},return(){trace.push('close');return {};}};function* run(){try{return yield*delegate;}catch(error){return error.name;}}const result=[run().next(),trace];",
  },
  {
    name: "owned delegate next replacement after suspension",
    source:
      "function* child(){yield 1;return 2;}const delegate=child();function* run(){return yield*delegate;}const iterator=run();const result=[iterator.next()];delegate.next=()=>{throw Error('replacement');};try{result.push(iterator.next());}catch(error){result.push(error.message);}",
  },
  {
    name: "cached delegate next getter",
    source:
      "let reads=0,count=0;const delegate={[Symbol.iterator](){return this;},get next(){reads++;return ()=>({done:++count>2,value:count});}};function* run(){return yield*delegate;}const iterator=run();const result=[iterator.next(),iterator.next(),iterator.next(),reads];",
  },
  {
    name: "delegate next replacement after suspension",
    source:
      "let count=0;const delegate={[Symbol.iterator](){return this;},next(){return {done:++count>1,value:count};}};function* run(){return yield*delegate;}const iterator=run();const result=[iterator.next()];delegate.next=()=>{throw Error('replacement');};try{result.push(iterator.next());}catch(error){result.push(error.message);}",
  },
  {
    name: "delegate next setup failure without delegate throw",
    source:
      "const trace=[];const delegate={[Symbol.iterator](){return this;},get next(){trace.push('next');throw Error('setup');},throw(){trace.push('throw');return {done:true,value:1};}};function* run(){try{return yield*delegate;}catch(error){return error.message;}}const result=[run().next(),trace];",
  },
  {
    name: "dynamic delegate throw methods with cached next",
    source:
      "const trace=[];const delegate={[Symbol.iterator](){return this;},get next(){trace.push('next');return ()=>({done:false,value:1});},get throw(){trace.push('throw');return value=>({done:false,value});}};function* run(){return yield*delegate;}const iterator=run();const result=[iterator.next(),iterator.throw(2)];Object.defineProperty(delegate,'throw',{value(value){return {done:true,value:value+10};}});result.push(iterator.throw(3),trace);",
  },
  {
    name: "dynamic delegate return methods with cached next",
    source:
      "const trace=[];const delegate={[Symbol.iterator](){return this;},get next(){trace.push('next');return ()=>({done:false,value:1});},get return(){trace.push('return');return value=>({done:false,value});}};function* run(){return yield*delegate;}const iterator=run();const result=[iterator.next(),iterator.return(2),iterator.next()];Object.defineProperty(delegate,'return',{value(value){return {done:true,value:value+10};}});result.push(iterator.return(3),trace);",
  },
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
  const native: unknown = runInNewContext(
    `(function(){"use strict";${source}\nreturn result;})()`,
    {},
    { timeout: 10000 },
  );
  expect(await evaluateLowered(source)).toEqual(native);
});

it("drives twenty thousand delegated frames without native recursion", async () => {
  expect(
    await evaluateLowered(
      "function* run(depth){if(!depth)return 0;return 1+(yield*run(depth-1));}const result=run(20000).next();",
    ),
  ).toEqual({ value: 20000, done: true });
}, 30_000);
