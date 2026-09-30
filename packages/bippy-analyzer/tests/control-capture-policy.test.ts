import { expect, it } from "vite-plus/test";
import { evaluateLowered } from "./helpers/control-fixture.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

const imports = `
  import { captureControlWithPolicy } from "#engine-control";
  import { registerNativeClosure } from "#native-captures";
`;

it("keeps the policy entry point out of the public engine API", async () => {
  const { api } = await getSymbolicEngine();
  expect(Reflect.has(api, "captureControlWithPolicy")).toBe(false);
});

it.each([
  "undefined",
  '{mode:"borrowed",references:[]}',
  '{mode:"readonly",references:[]}',
  '{mode:"expand"}',
  '{mode:"opaque"}',
])("rejects an incomplete inspection %s before native metadata", async (decision) => {
  const result = await evaluateLowered(`
    ${imports}
    let factories=0, captures=0, inspections=0;
    const callback=registerNativeClosure(()=>7,()=>{ factories++; return {bindings:[],ambientNames:[]}; });
    function* run(){ yield "pause"; return callback(); }
    const iterator=run(); iterator.next();
    let message;
    try { captureControlWithPolicy(iterator, {
      inspect(value){ inspections++; return ${decision}; },
      capture(){ captures++; return {restore(){}}; }
    }); } catch(error) { message=error.message; }
    const result={factories,captures,inspections,message,value:iterator.next().value};
  `);
  expect(result).toEqual({
    factories: 0,
    captures: 0,
    inspections: 1,
    message:
      decision.includes('"expand"') || decision.includes('"opaque"')
        ? "Control capture policies require explicit references"
        : "Unclassified control dependency",
    value: 7,
  });
});

it("does not read references for an unknown mode", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const callback=()=>7;
    function* run(){ yield; return callback(); }
    const iterator=run(); iterator.next(); let reads=0,message;
    try { captureControlWithPolicy(iterator, {
      inspect(){ return {mode:"unknown", get references(){ reads++;throw Error("getter"); }}; },
      capture(){ throw Error("capture"); }
    }); } catch(error){message=error.message;}
    const result={reads,message};
  `),
  ).toEqual({ reads: 0, message: "Unclassified control dependency" });
});

it.each([false, true])(
  "restores explicitly owned callback state without its metadata in order %s",
  async (first) => {
    let prefixes = 0;
    expect(
      await evaluateLowered(
        `
    ${imports}
    const state={count:0}, alias=state;
    let factories=0, inspections=0;
    const callback=registerNativeClosure(choice=>{ state.count+=choice?11:12; return [state===alias,state.count]; },()=>{ factories++; throw Error("unapproved metadata"); });
    function* run(){ prefix(); const choice=yield "pause"; return callback(choice); }
    const iterator=run(); iterator.next();
    const checkpoint=captureControlWithPolicy(iterator, {
      inspect(value){
        inspections++;
        if(value===callback) return {mode:"opaque",references:[state]};
        if(value===state) return {mode:"opaque",references:[]};
      },
      admitAmbient(name){return name==="prefix";},
      capture(roots){
        if(roots.ambientNames.join()!=="prefix" || !roots.values.includes(state)) throw Error("unaccounted roots");
        const saved=state.count; return {restore(){state.count=saved;}};
      }
    });
    const first=iterator.next(${first}).value; checkpoint.restore();
    const second=iterator.next(${!first}).value; checkpoint.restore();
    const result={first,second,factories,inspections,count:state.count};
  `,
        {
          prefix: () => {
            prefixes++;
          },
        },
      ),
    ).toEqual({
      first: [true, first ? 11 : 12],
      second: [true, first ? 12 : 11],
      factories: 0,
      inspections: 2,
      count: 0,
    });
    expect(prefixes).toBe(1);
  },
);

it("retains expansion and original captured binding restoration when explicitly selected", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    let count=0, factories=0;
    const callback=registerNativeClosure(choice=>count+=choice?11:12,()=>({
      bindings:[{name:"count",get:()=>{factories++;return count;},set:value=>{count=value;}}],ambientNames:[]
    }));
    function* run(){ return callback(yield "pause"); }
    const iterator=run(); iterator.next();
    const checkpoint=captureControlWithPolicy(iterator, {
      inspect(value){ if(value===callback)return {mode:"expand",references:[]}; },
      capture(){ return {restore(){}}; }
    });
    const first=iterator.next(true).value; checkpoint.restore(); const second=iterator.next(false).value;
    const result={first,second,factories};
  `),
  ).toEqual({ first: 11, second: 12, factories: 1 });
});

it("rejects a metadata descendant without treating an empty parent reference list as transitive admission", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    let parentFactories=0, childFactories=0,captures=0;
    const child=registerNativeClosure(()=>0,()=>{childFactories++;return{bindings:[],ambientNames:[]};});
    const parent=registerNativeClosure(()=>0,()=>{parentFactories++;return{bindings:[{name:"child",get:()=>child}],ambientNames:[]};});
    function* run(){yield;return parent();}
    const iterator=run();iterator.next();let message;
    try{captureControlWithPolicy(iterator,{
      inspect(value){if(value===parent)return{mode:"expand",references:[]};},
      capture(){captures++;return{restore(){}};}
    });}catch(error){message=error.message;}
    const result={parentFactories,childFactories,captures,message};
  `),
  ).toEqual({
    parentFactories: 1,
    childFactories: 0,
    captures: 0,
    message: "Unclassified control dependency",
  });
});

it("inspects opaque dependencies and deduplicates their cycles", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const first={},second={};const inspected=[];
    function* run(){yield;return first===first;}
    const iterator=run();iterator.next();
    captureControlWithPolicy(iterator,{
      inspect(value){inspected.push(value===first?"first":"second");return{mode:"opaque",references:value===first?[first,second,second]:[first]};},
      capture(){return{restore(){}};}
    });
    const result=inspected;
  `),
  ).toEqual(["first", "second"]);
});

it("keeps original LIFO priority across policy and metadata references", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const trace=[],policyFirst={},policyLast={},metadataChild={};
    const callback=registerNativeClosure(()=>0,()=>{trace.push("factory");return{bindings:[{name:"child",get:()=>metadataChild}],ambientNames:[]};});
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    captureControlWithPolicy(iterator,{
      inspect(value){
        if(value===callback){trace.push("inspect");return{mode:"expand",references:[policyFirst,policyLast]};}
        trace.push(value===policyFirst?"first":value===policyLast?"last":"metadata");
        return{mode:"opaque",references:[]};
      },capture(){return{restore(){}};}
    });const result=trace;
  `),
  ).toEqual(["inspect", "factory", "last", "first", "metadata"]);
});

it("reads the chosen mode and reference list once with original policy receivers", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const callback=()=>7;let modes=0,references=0;const receivers=[];
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    const policy={
      beginCapture(){receivers.push(this===policy);},
      inspect(){receivers.push(this===policy);return{get mode(){modes++;return"opaque";},get references(){references++;return[];}};},
      capture(){receivers.push(this===policy);return{restore(){}};}
    };
    captureControlWithPolicy(iterator,policy);const result={modes,references,receivers};
  `),
  ).toEqual({ modes: 1, references: 1, receivers: [true, true, true] });
});

it.each(["inspection", "iterator", "capture"])(
  "preserves the exact %s failure, releases capture lock, and does not roll back hooks",
  async (stage) => {
    expect(
      await evaluateLowered(`
    ${imports}
    const callback=()=>7,failure={stage:${JSON.stringify(stage)}};let effects=0,caught;
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    try{captureControlWithPolicy(iterator,{
      inspect(){
        effects++;
        if(failure.stage==="inspection") throw failure;
        const references=failure.stage==="iterator"?{[Symbol.iterator](){return{next(){throw failure;}}}}:[];
        return {mode:"opaque",references};
      },
      capture(){throw failure;}
    });}catch(error){caught=error;}
    const saved=captureControlWithPolicy(iterator,{inspect(){return{mode:"opaque",references:[]};},capture(){return{restore(){}};}});
    saved.restore(); const result={exact:caught===failure,effects,value:iterator.next().value};
  `),
    ).toEqual({ exact: true, effects: 1, value: 7 });
  },
);

it("places policy references in the live roots before the next iterator step and metadata factory", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const target={},checks=[];let roots;
    const callback=registerNativeClosure(()=>0,()=>{checks.push(roots.includes(target));return{bindings:[],ambientNames:[]};});
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    captureControlWithPolicy(iterator,{
      inspect(value){
        if(value!==callback) return {mode:"opaque",references:[]};
        const references={ [Symbol.iterator](){
          let index=0;
          return { next(){
            if(index++===0) return {done:false,value:target};
            checks.push(roots.includes(target));
            return {done:true};
          } };
        } };
        return {mode:"expand",references};
      },
      capture(){return{restore(){}};}
    },()=>[],values=>{roots=values;}); const result=checks;
  `),
  ).toEqual([true, true]);
});

it("does not globally suppress metadata or make an incomplete opaque policy sound", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    let count=0,factories=0;
    const callback=registerNativeClosure(()=>++count,()=>{factories++;return{bindings:[{name:"count",get:()=>count,set:value=>{count=value;}}],ambientNames:[]};});
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    const saved=captureControlWithPolicy(iterator,{inspect(){return{mode:"opaque",references:[]};},capture(){return{restore(){}};}});
    const first=iterator.next().value;saved.restore();const second=iterator.next().value;
    const before=factories;getNativeCaptures(callback);const result={first,second,before,after:factories};
  `),
  ).toEqual({ first: 1, second: 2, before: 0, after: 1 });
});

it("preserves legacy empty-reference expansion", async () => {
  expect(
    await evaluateLowered(`
    let count=0;const callback=()=>++count;
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();
    const saved=captureControl(iterator,{references(){return[];},capture(){return{restore(){}};}});
    const first=iterator.next().value;saved.restore();const second=iterator.next().value;
    const result=[first,second];
  `),
  ).toEqual([1, 1]);
});

it("uses the existing restoration poison protocol", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const target={},failure=Error("restore failed");
    function* run(){yield;return target;}
    const iterator=run();iterator.next();
    const saved=captureControlWithPolicy(iterator,{inspect(){return{mode:"opaque",references:[]};},capture(){return{restore(){throw failure;}};}});
    let first,second;
    try{saved.restore();}catch(error){first=error===failure;}
    try{iterator.next();}catch(error){second=error.message;}
    const result={first,second};
  `),
  ).toEqual({ first: true, second: "Control checkpoint restoration failed" });
});

it.each(["absent", "false", "truthy"])(
  "rejects %s ambient admission before capture",
  async (mode) => {
    expect(
      await evaluateLowered(`
    ${imports}
    function* run(){yield;return external();}
    const iterator=run();iterator.next();let captures=0,message;
    try{captureControlWithPolicy(iterator,{
      inspect(){throw Error("unexpected object");},
      ${mode === "absent" ? "" : `admitAmbient(){return ${mode === "false" ? "false" : '"yes"'};},`}
      capture(){captures++;return{restore(){}};}
    });}catch(error){message=error.message;}
    const result={captures,message};
  `),
    ).toEqual({ captures: 0, message: "Unclassified control ambient: external" });
  },
);

it("requires approval for ambient names from expanded native captures", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const callback=registerNativeClosure(()=>0,()=>({bindings:[],ambientNames:["capability"]}));
    function* run(){yield;return callback();}
    const iterator=run();iterator.next();let message;
    try{captureControlWithPolicy(iterator,{inspect(){return{mode:"expand",references:[]};},capture(){throw Error("capture");}});}catch(error){message=error.message;}
    const result=message;
  `),
  ).toBe("Unclassified control ambient: capability");
});

it("rejects an unclassified declared dependency beneath an opaque parent", async () => {
  expect(
    await evaluateLowered(`
    ${imports}
    const child={};let factories=0,captures=0,message;
    const parent=registerNativeClosure(()=>0,()=>{factories++;throw Error("factory");});
    function* run(){yield;return parent();}
    const iterator=run();iterator.next();
    try{captureControlWithPolicy(iterator,{
      inspect(value){if(value===parent)return{mode:"opaque",references:[child]};},
      capture(){captures++;return{restore(){}};}
    });}catch(error){message=error.message;}
    const result={factories,captures,message};
  `),
  ).toEqual({ factories: 0, captures: 0, message: "Unclassified control dependency" });
});

it("preserves ambient-admission failure identity and receiver, and permits recovery", async () => {
  expect(
    await evaluateLowered(
      `
    ${imports}
    const failure={};let caught,receiver,captures=0;
    function* run(){yield;return external();}
    const iterator=run();iterator.next();
    const policy={
      inspect(){throw Error("unexpected object");},
      admitAmbient(){receiver=this===policy;throw failure;},
      capture(){captures++;return{restore(){}};}
    };
    try{captureControlWithPolicy(iterator,policy);}catch(error){caught=error;}
    const skipped=captures===0;
    policy.admitAmbient=()=>true;
    const saved=captureControlWithPolicy(iterator,policy);saved.restore();
    const result={exact:caught===failure,receiver,skipped,captures,value:iterator.next().value};
  `,
      { external: () => 7 },
    ),
  ).toEqual({ exact: true, receiver: true, skipped: true, captures: 1, value: 7 });
});
