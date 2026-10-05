import { expect, it } from "vite-plus/test";
import { evaluateLowered } from "./helpers/lowered-engine.js";

const profile = `
const owner = new OwnedState({
  describe: value => Array.isArray(value) ? 'array' : value instanceof Map ? 'map' : value instanceof Set ? 'set' : Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null ? 'record' : undefined,
  ambientNames: ['Object','Array','Map','Set','undefined']
});
`;

it("restores transitive escaped cells, aliases, callbacks and completions without replaying the prefix", async () => {
  expect(
    await evaluateLowered(`
    let prefixes=0;
    const shared={value:2}; const alias=shared; const tasks=[];
    const create=()=>{let count=0;return {read:()=>count,increment:()=>++count}};
    const closure=create();
    function* run(){
      prefixes++; const enabled=yield 'decision';
      try {
        if(enabled) {alias.value++;closure.increment()}
        tasks.push(()=>[shared.value,closure.read()]);
        if(enabled) throw shared;
        return shared;
      } finally {shared.value+=10}
    }
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);
    let thrown;try{iterator.next(true)}catch(value){thrown=value}
    const first=[thrown===shared,shared.value,closure.read(),tasks[0]()];
    checkpoint.restore();
    const baseline=[prefixes,shared.value,closure.read(),tasks.length];
    const returned=iterator.next(false);
    const result=[first,baseline,returned.value===shared,shared.value,closure.read(),tasks[0]()];
  `),
  ).toEqual([[true, 13, 1, [13, 1]], [1, 2, 0, 0], true, 12, 0, [12, 0]]);
});

it("finds a completed creator frame through a callback stored in a heap object", async () => {
  expect(
    await evaluateLowered(`
    function* create(){let value=3;return {read:()=>value,write:next=>{value=next}}}
    const closure=create().next().value;
    const holder={closure};
    function* run(){yield 'decision';holder.closure.write(8);return holder.closure.read()}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);
    const first=iterator.next().value; checkpoint.restore();
    const result=[first,closure.read(),iterator.next().value];
  `),
  ).toEqual([8, 3, 8]);
});

it("restores maps, sets, cycles, symbol descriptors and sparse arrays", async () => {
  expect(
    await evaluateLowered(`
    const key=Symbol('key');const shared={value:1};shared.self=shared;
    const map=new Map([[shared,'first']]); const set=new Set([shared]);const list=[,shared];
    Object.defineProperty(shared,key,{value:4,writable:true,configurable:true});
    function* run(){yield 'decision';map.clear();map.set('second',shared);set.clear();list.push(7);list[0]=2;shared[key]=9;shared.extra=3;return list.length}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);iterator.next();checkpoint.restore();
    const result=[map.get(shared),Array.from(set)[0]===shared,list.length,0 in list,list[1]===shared,shared.self===shared,shared[key],Object.hasOwn(shared,'extra')];
  `),
  ).toEqual(["first", true, 2, false, true, true, 4, false]);
});

it("does not invoke native accessor bodies during discovery", async () => {
  expect(
    await evaluateLowered(`
    let reads=0; const getter=()=>{reads++;return 4};const object={};
    Object.defineProperty(object,'value',{get:getter,configurable:true});
    function* run(){yield 'decision';return object.value}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);const first=iterator.next().value;checkpoint.restore();
    const result=[reads,first,iterator.next().value,reads];
  `),
  ).toEqual([0, 4, 4, 1]);
});

it("rejects undeclared ambient state and unregistered native callbacks", async () => {
  await expect(
    evaluateLowered(
      `
    function* run(){yield 1;return external()}
    const iterator=run();iterator.next(); ${profile}
    const result=captureControl(iterator,owner);
  `,
      { external: () => 2 },
    ),
  ).rejects.toThrow("Undeclared native ambient: external");
  await expect(
    evaluateLowered(
      `
    const callback=external;
    function* run(){yield 1;return callback()}
    const iterator=run();iterator.next(); ${profile}
    const result=captureControl(iterator,owner);
  `,
      { external: () => 2 },
    ),
  ).rejects.toThrow("Cannot own a native closure without capture metadata");
});

it("does not reuse a partially discovered graph after a failed capture", async () => {
  expect(
    await evaluateLowered(
      `
    const object={value:1,callback:external};function* run(){yield 1;return object.value}
    const iterator=run();iterator.next(); ${profile}
    let first,second;
    try{captureControl(iterator,owner)}catch(error){first=error.message}
    delete object.callback;object.value=2;
    try{captureControl(iterator,owner)}catch(error){second=error.message}
    const result=[first,second,iterator.next().value];
  `,
      { external: () => 0 },
    ),
  ).toEqual([
    "Cannot own a native closure without capture metadata",
    "Owned state is single-use",
    2,
  ]);
});

it("does not retain unused activation inputs as heap roots", async () => {
  expect(
    await evaluateLowered(
      `
    function* run(unused,value){yield 1;return value}
    const iterator=run(external,2);iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);const first=iterator.next().value;checkpoint.restore();
    const result=[first,iterator.next().value];
  `,
      { external: () => 0 },
    ),
  ).toEqual([2, 2]);
});

it("requires explicit schemas rather than guessing ownership from prototypes", async () => {
  await expect(
    evaluateLowered(`
    const object={value:1};function* run(){yield 1;return object.value}
    const iterator=run();iterator.next();
    const result=captureControl(iterator,new OwnedState({describe:()=>undefined}));
  `),
  ).rejects.toThrow("Native state has no declared ownership schema");
});

it("rejects native proxies without invoking their traps", async () => {
  let traps = 0;
  const object = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        traps++;
        throw new Error("trap");
      },
    },
  );
  await expect(
    evaluateLowered(
      `
    const object=external;function* run(){yield 1;return object}
    const iterator=run();iterator.next(); ${profile}
    const result=captureControl(iterator,owner);
  `,
      { external: object },
    ),
  ).rejects.toThrow("Cannot own a native proxy");
  expect(traps).toBe(0);
});

it("poisons control instead of continuing after irreversible native changes", async () => {
  expect(
    await evaluateLowered(`
    const object={value:1};function* run(){yield 1;Object.freeze(object);return 2}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);iterator.next();
    let restoreError, resumeError;
    try{checkpoint.restore()}catch(error){restoreError=error.message}
    try{iterator.next()}catch(error){resumeError=error.message}
    const result=[restoreError,resumeError];
  `),
  ).toEqual([
    "Owned state extensibility changed irreversibly",
    "Control checkpoint restoration failed",
  ]);
});

it("restores configurable property order rather than only restoring values", async () => {
  expect(
    await evaluateLowered(`
    const object={};Object.defineProperty(object,'fixed',{value:0});
    object.first=1;object.second=2;Object.defineProperty(object,Symbol('fixed'),{value:0});
    function* run(){yield 1;delete object.first;object.first=3}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);iterator.next();checkpoint.restore();
    const result=Object.entries(object);
  `),
  ).toEqual([
    ["first", 1],
    ["second", 2],
  ]);
});

it("refuses impossible property-order restoration across a nonconfigurable key", async () => {
  await expect(
    evaluateLowered(`
    const object={first:1};Object.defineProperty(object,'second',{value:2});
    function* run(){yield 1;delete object.first;object.first=3}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);iterator.next();checkpoint.restore();
    const result=object;
  `),
  ).rejects.toThrow("Owned state property order cannot be restored");
});

it("includes custom array prototypes in the owned graph", async () => {
  expect(
    await evaluateLowered(`
    const list=[];Object.setPrototypeOf(list,{value:2});
    function* run(){yield 1;Object.getPrototypeOf(list).value=7;return list.value}
    const iterator=run();iterator.next(); ${profile}
    const checkpoint=captureControl(iterator,owner);iterator.next();checkpoint.restore();
    const result=list.value;
  `),
  ).toBe(2);
});

it("rejects hidden arguments state even when a profile incorrectly calls it a record", async () => {
  await expect(
    evaluateLowered(`
    function create(value){return ()=>arguments[0]}
    const read=create(2);function* run(){yield 1;return read()}
    const iterator=run();iterator.next(); ${profile}
    const result=captureControl(iterator,owner);
  `),
  ).rejects.toThrow("Native internal state requires an ownership adapter");
});
