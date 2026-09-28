import { expect, it } from "vite-plus/test";
import { evaluateLowered } from "./helpers/control-fixture.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it("resumes an engine262 expression continuation without evaluating its prefix again", async () => {
  const { api } = await getSymbolicEngine();
  const {
    Agent,
    ManagedRealm,
    NormalCompletion,
    ScriptEvaluation,
    captureControl,
    setSurroundingAgent,
    skipDebugger,
  } = api;
  const previous = api.surroundingAgent;
  let prefixVisits = 0;
  const agent = new Agent({
    startEventLoop: false,
    onDebugger: () => {},
    onNodeEvaluation: (node) => {
      if (node.type === "AdditiveExpression" && node.sourceText === "1 + 2") prefixVisits++;
    },
  });
  setSurroundingAgent(agent);
  try {
    const realm = new ManagedRealm();
    const compiled = realm.compileScript("1 + 2; debugger; 40 + 2;");
    if (!(compiled instanceof NormalCompletion))
      throw new Error("Expression fixture did not compile");
    const iterator = ScriptEvaluation(compiled.Value);
    let step = iterator.next();
    while (!step.done && step.value.suspend !== "debugger")
      step = iterator.next({ resume: "debugger", value: undefined });
    expect(step.done).toBe(false);
    const contexts = [...agent.executionContextStack];
    const checkpoint = captureControl(iterator, {
      capture: () => ({
        restore: () => {
          agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
        },
      }),
    });
    const first = skipDebugger(iterator);
    setSurroundingAgent(new Agent({ startEventLoop: false }));
    expect(() => checkpoint.restore()).toThrow("Read-only capture changed: surroundingAgent");
    setSurroundingAgent(agent);
    checkpoint.restore();
    const second = skipDebugger(iterator);
    if (!(first instanceof NormalCompletion) || !(second instanceof NormalCompletion))
      throw new Error("Expression fixture did not complete normally");
    expect(api.SameValue(first.Value, api.Value(42))).toBe(true);
    expect(api.SameValue(second.Value, api.Value(42))).toBe(true);
    expect(prefixVisits).toBe(1);
  } finally {
    setSurroundingAgent(previous);
  }
});

const scalarOwner = "const owner={capture:()=>({restore(){}})};";

it("resumes two alternatives without executing the effectful prefix again", async () => {
  let prefixCalls = 0;
  const result = await evaluateLowered(
    `${scalarOwner}
    function* run(value=1, read=()=>value) {
      observePrefix();
      const enabled=yield 'decision';
      if(enabled) value+=10;
      return read();
    }
    const iterator=run();
    const first=iterator.next();
    const checkpoint=captureControl(iterator,owner);
    const enabled=iterator.next(true);
    checkpoint.restore();
    const disabled=iterator.next(false);
    const result={first,enabled,disabled};`,
    {
      observePrefix: () => {
        prefixCalls++;
      },
    },
  );
  expect(prefixCalls).toBe(1);
  expect(result).toEqual({
    first: { value: "decision", done: false },
    enabled: { value: 11, done: true },
    disabled: { value: 1, done: true },
  });
});

it("restores captured locals in a completed creator frame", async () => {
  expect(
    await evaluateLowered(`${scalarOwner}
    function* factory(){let count=1;return function* child(){const enabled=yield 'decision'; count+=enabled?10:1; return count;};}
    const child=factory().next().value;
    const iterator=child();iterator.next();
    let owned;
    const checkpoint=captureControl(iterator,{capture(roots){owned=roots.controlOwnedObjects.length;return {restore(){}};}});
    const enabled=iterator.next(true).value;
    checkpoint.restore();
    const disabled=iterator.next(false).value;
    const result={enabled,disabled,owned};`),
  ).toEqual({ enabled: 11, disabled: 2, owned: 4 });
});

it("roots and restores the cached method after completing different delegates", async () => {
  expect(
    await evaluateLowered(`
    function* child(){return yield 'decision';}
    function* run(){const first=yield*child();return [first,yield*child()];}
    const iterator=run();iterator.next();
    const nextMethod=Object.getPrototypeOf(iterator).next;
    let hasNextMethod=false;
    const checkpoint=captureControl(iterator,{capture(roots){hasNextMethod=roots.values.includes(nextMethod);return {restore(){}};}});
    iterator.next(2);
    const first=iterator.next(3);
    let hasCompletedMethod=true;
    captureControl(iterator,{capture(roots){hasCompletedMethod=roots.values.includes(nextMethod);return {restore(){}};}});
    checkpoint.restore();
    iterator.next(5);
    const second=iterator.next(7);
    checkpoint.restore();
    const returned=iterator.return(11);
    checkpoint.restore();
    iterator.next(13);
    const third=iterator.next(17);
    const result={hasNextMethod,hasCompletedMethod,first,second,returned,third};`),
  ).toEqual({
    hasNextMethod: true,
    hasCompletedMethod: false,
    first: { done: true, value: [2, 3] },
    second: { done: true, value: [5, 7] },
    returned: { done: true, value: 11 },
    third: { done: true, value: [13, 17] },
  });
});

it("restores a delegated continuation and its caller locals", async () => {
  expect(
    await evaluateLowered(`${scalarOwner}
    function* child(){return yield 'decision';}
    function* run(){let value=10;value+=yield*child();return value;}
    const iterator=run();iterator.next();
    const checkpoint=captureControl(iterator,owner);
    const first=iterator.next(2).value;checkpoint.restore();
    const second=iterator.next(5).value;
    const result=[first,second];`),
  ).toEqual([12, 15]);
});

it("restores a pending return through a yielding finally", async () => {
  expect(
    await evaluateLowered(`${scalarOwner}
    function* run(){try{yield 'body';}finally{yield 'cleanup';}}
    const iterator=run();iterator.next();iterator.return(5);
    const checkpoint=captureControl(iterator,owner);
    const overridden=iterator.return(9);checkpoint.restore();
    const original=iterator.next();
    const result=[overridden,original];`),
  ).toEqual([
    { value: 9, done: true },
    { value: 5, done: true },
  ]);
});

it("restores a pending throw and the same thrown identity", async () => {
  expect(
    await evaluateLowered(`${scalarOwner}
    const error={marker:1};
    function* run(){try{yield 'body';}finally{yield 'cleanup';}}
    const iterator=run();iterator.next();iterator.throw(error);
    const checkpoint=captureControl(iterator,owner);
    const returned=iterator.return(4).value;checkpoint.restore();
    let same=false;try{iterator.next();}catch(thrown){same=thrown===error;}
    const result=[returned,same];`),
  ).toEqual([4, true]);
});

it("allows a declared state owner to restore heap aliases and queued callbacks", async () => {
  let prefixCalls = 0;
  expect(
    await evaluateLowered(
      `
    const shared={count:1};const alias=shared;const jobs=[];
    function* run(){observePrefix();const enabled=yield 'decision';if(enabled) shared.count+=2;jobs.push(()=>alias.count);try{return shared.count;}finally{shared.count+=10;}}
    const iterator=run();iterator.next();
    let hasRoot=false;
    const checkpoint=captureControl(iterator,{capture(roots){hasRoot=roots.values.includes(shared);const count=shared.count;const length=jobs.length;return{restore(){shared.count=count;jobs.length=length;}};}});
    const enabled={value:iterator.next(true).value,job:jobs[0](),same:alias===shared};
    checkpoint.restore();
    const disabled={value:iterator.next(false).value,job:jobs[0](),same:alias===shared};
    const result={enabled,disabled,hasRoot,jobs:jobs.length};`,
      {
        observePrefix: () => {
          prefixCalls++;
        },
      },
    ),
  ).toEqual({
    enabled: { value: 3, job: 13, same: true },
    disabled: { value: 1, job: 11, same: true },
    hasRoot: true,
    jobs: 1,
  });
  expect(prefixCalls).toBe(1);
});

it.each([
  {
    name: "frame locals",
    parameters: "",
    initialize: "let shared={count:1};const read=()=>shared;",
  },
  {
    name: "native parameter captures",
    parameters: "shared={count:1},read=()=>shared",
    initialize: "",
  },
])("restores $name before the heap policy runs", async ({ parameters, initialize }) => {
  expect(
    await evaluateLowered(`
    function* run(${parameters}){${initialize}yield read;shared.count=3;shared={count:8};return read();}
    const iterator=run();const read=iterator.next().value;
    const checkpoint=captureControl(iterator,{capture(){const count=read().count;return{restore(){read().count=count;}};}});
    const changed=iterator.next().value.count;checkpoint.restore();
    const result=[changed,read().count];`),
  ).toEqual([8, 1]);
});

it.each([
  {
    name: "initial entry",
    source: "function* run(){yield 1;return 5;}",
    prefix: "",
    first: "iterator.return(7)",
    second: "iterator.next(100)",
  },
  {
    name: "caught throws",
    source: "function* run(){try{yield 1;}catch(error){return error+10;}finally{yield 2;}}",
    prefix: "iterator.next();",
    first: "iterator.throw(3)",
    second: "iterator.return(7)",
  },
  {
    name: "nested finally returns",
    source: "function* run(){try{try{yield 1;}finally{yield 2;}}finally{yield 3;}}",
    prefix: "iterator.next();iterator.return(5);",
    first: "iterator.return(8)",
    second: "iterator.next()",
  },
  {
    name: "delegated cleanup",
    source:
      "function* child(){try{yield 1;}finally{yield 2;}}function* run(){yield*child();return 17;}",
    prefix: "iterator.next();",
    first: "iterator.return(4)",
    second: "iterator.next()",
  },
  {
    name: "pending exceptions",
    source: "function* run(){try{try{yield 1;}finally{yield 2;}}catch(error){return error+30;}}",
    prefix: "iterator.next();iterator.throw(5);",
    first: "iterator.throw(8)",
    second: "iterator.next()",
  },
  {
    name: "mutable parameter captures",
    source:
      "function* run(value=1,read=()=>value){const enabled=yield 1;if(enabled)value+=2;return read();}",
    prefix: "iterator.next();",
    first: "iterator.next(true)",
    second: "iterator.next(false)",
  },
])("matches independent native witnesses for $name", async ({ source, prefix, first, second }) => {
  const setup = `${source}\nconst iterator=run();${prefix}
    const observe=resume=>{const steps=[];try{let step=resume();steps.push(step);while(!step.done){step=iterator.next();steps.push(step);}}catch(error){steps.push({thrown:error});}return steps;};`;
  const native = [first, second].map((resume) =>
    new Function(`${setup}\nreturn observe(()=>${resume});`)(),
  );
  expect(
    await evaluateLowered(`${scalarOwner}${setup}
    const checkpoint=captureControl(iterator,owner);
    const first=observe(()=>${first});checkpoint.restore();
    const second=observe(()=>${second});const result=[first,second];`),
  ).toEqual(native);
});

it("allows state owners to reject opaque native closures rather than pretending to capture them", async () => {
  expect(
    await evaluateLowered(`
    function* run(value=0,update=()=>++value){yield 1;return update();}
    const iterator=run();iterator.next();let result;
    try{captureControl(iterator,{capture(roots){if(roots.values.some(value=>typeof value==='function'))throw new Error('Opaque native closure');return{restore(){}};}});}catch(error){result=error.message;}`),
  ).toBe("Opaque native closure");
});

it("requires an explicit state owner", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;}const iterator=run();iterator.next();let result;try{captureControl(iterator);}catch(error){result=error.message;}`,
    ),
  ).toBe("Control checkpoints require a state owner");
});

it("rejects foreign delegates before asking the owner to capture", async () => {
  expect(
    await evaluateLowered(
      `let captures=0;function* run(){yield* [1,2];}const iterator=run();iterator.next();let message;try{captureControl(iterator,{capture(){captures++;return{restore(){}};}});}catch(error){message=error.message;}const result=[message,captures,iterator.next().value];`,
    ),
  ).toEqual(["Cannot checkpoint a foreign delegate", 0, 2]);
  expect(
    await evaluateLowered(`${scalarOwner}
    function* child(){yield 1;return 2;}const delegate=child();
    function* run(){return yield*delegate;}const iterator=run();iterator.next();
    const checkpoint=captureControl(iterator,owner);let reads=0;
    Object.defineProperty(delegate,'next',{get(){reads++;return()=>({done:true});}});
    const messages=[];
    for(const attempt of [()=>captureControl(iterator,owner),()=>checkpoint.restore()]) {
      try{attempt();}catch(error){messages.push(error.message);}
    }
    const result=[messages,reads];`),
  ).toEqual([
    [
      "Cannot checkpoint overridden continuation methods",
      "Cannot checkpoint overridden continuation methods",
    ],
    0,
  ]);
});

it("rejects checkpointing from a running continuation", async () => {
  expect(
    await evaluateLowered(
      `${scalarOwner}function* run(){try{captureControl(iterator,owner);}catch(error){return error.message;}}const iterator=run();const result=iterator.next().value;`,
    ),
  ).toBe("Cannot checkpoint during execution or another checkpoint");
});

it("rejects restoring from a running continuation", async () => {
  expect(
    await evaluateLowered(
      `${scalarOwner}let checkpoint;function* run(){yield 1;try{checkpoint.restore();}catch(error){return error.message;}}const iterator=run();iterator.next();checkpoint=captureControl(iterator,owner);const result=iterator.next().value;`,
    ),
  ).toBe("Cannot restore during execution or another checkpoint");
});

it("does not resume a continuation from its state-capture policy", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;return 2;}const iterator=run();iterator.next();let message;try{captureControl(iterator,{capture(){iterator.next();return{restore(){}};}});}catch(error){message=error.message;}const result=[message,iterator.next()];`,
    ),
  ).toEqual(["Cannot resume during a control checkpoint", { value: 2, done: true }]);
});

it("leaves control unchanged when a capture policy rejects its roots", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;return 2;}const iterator=run();iterator.next();let message;try{captureControl(iterator,{capture(){throw new Error('unsupported heap');}});}catch(error){message=error.message;}const result=[message,iterator.next().value];`,
    ),
  ).toEqual(["unsupported heap", 2]);
});

it("poisons captured continuations when restoring external state fails", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;return 2;}const iterator=run();iterator.next();const checkpoint=captureControl(iterator,{capture(){return{restore(){throw new Error('restore failed');}};}});let restored;try{checkpoint.restore();}catch(error){restored=error.message;}let resumed;try{iterator.next();}catch(error){resumed=error.message;}const result=[restored,resumed];`,
    ),
  ).toEqual(["restore failed", "Control checkpoint restoration failed"]);
});

it("rejects accessor locals without invoking their getters", async () => {
  let reads = 0;
  expect(
    await evaluateLowered(
      `${scalarOwner}function* run(){yield 1;}const iterator=run();iterator.next();Object.defineProperty(iterator.l,'hidden',{get:observeRead,configurable:true});let result;try{captureControl(iterator,owner);}catch(error){result=error.message;}`,
      {
        observeRead: () => {
          reads++;
        },
      },
    ),
  ).toBe("Cannot checkpoint accessor or immutable frame locals");
  expect(reads).toBe(0);
});

it("rejects frozen locals before restoring external state", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;}const iterator=run();iterator.next();let restores=0;const checkpoint=captureControl(iterator,{capture(){return{restore(){restores++;}};}});Object.freeze(iterator.l);let message;try{checkpoint.restore();}catch(error){message=error.message;}const result=[message,restores];`,
    ),
  ).toEqual(["Cannot checkpoint non-extensible frame locals", 0]);
});

it("reports ambient dependencies without evaluating them", async () => {
  expect(
    await evaluateLowered(
      `function* run(){yield 1;return missingAmbientValue;}const iterator=run();iterator.next();let names;captureControl(iterator,{capture(roots){names=roots.ambientNames;return{restore(){}};}});const result=[names.includes('missingAmbientValue'),iterator.return(2).value];`,
    ),
  ).toEqual([true, 2]);
});
