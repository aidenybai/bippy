import { expect, it } from "vite-plus/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { createEngineProject, getFibers } from "./helpers/engine-renderer.js";
import { StaticRenderer } from "../src/render/static-renderer.js";
import { renderNativeEngineWitness } from "../src/corpus/native-engine-renderer.js";

const { directory, createSource, createRenderer } = createEngineProject();

it("runs application hooks, React DOM, and snapshot capture inside the production engine path", async () => {
  const filePath = resolve(directory, "counter.tsx");
  writeFileSync(
    filePath,
    "import{useState,useEffect}from'react';export default function Counter(){const[count,setCount]=useState(0);useEffect(()=>setCount(1),[]);return <button data-count={count}>{count}</button>}",
  );
  const renderer = new StaticRenderer({ rootDirectory: directory, execution: "engine" });
  const result = await renderer.renderComponent(filePath);
  expect(result.diagnostics).toEqual([]);
  expect(result.engine?.status).toBe("complete");
  expect(result.engine?.engineOwnedFunctions).toBeGreaterThanOrEqual(3);
  expect(result.snapshot.rendererName).toBe("react-dom");
  expect(getFibers(result.snapshot.roots).some((fiber) => fiber.name === "Counter")).toBe(true);
  expect(
    getFibers(result.snapshot.roots).find((fiber) => fiber.name === "button")?.props["data-count"],
  ).toBe(1);
  expect(result.commits.length).toBeGreaterThanOrEqual(2);
}, 60_000);

it.each([
  {
    name: "private class state",
    source:
      "import{Component}from'react';export default class Counter extends Component{#count=3;render(){return <output data-value={this.#count}/>}}",
    expected: 3,
  },
  {
    name: "context and reducers",
    source:
      "import{createContext,useContext,useReducer,useEffect}from'react';const Context=createContext(0);function Child(){const value=useContext(Context);const[count,add]=useReducer((value)=>value+1,0);useEffect(()=>add(),[]);return <output data-value={value+count}/>};export default()=> <Context.Provider value={4}><Child/></Context.Provider>",
    expected: 5,
  },
  {
    name: "lazy and Suspense",
    source:
      "import{lazy,Suspense}from'react';const Child=lazy(()=>Promise.resolve({default:()=> <output data-value='ready'/>}));export default()=> <Suspense fallback={<output data-value='waiting'/>}><Child/></Suspense>",
    expected: "ready",
  },
  {
    name: "callback refs and DOM events",
    source:
      "import{useState,useEffect,useRef}from'react';export default()=>{const[value,set]=useState(0);const ref=useRef(null);useEffect(()=>ref.current.click(),[]);return <output ref={ref} data-value={value} onClick={()=>set(7)}/>}",
    expected: 7,
  },
  {
    name: "timers",
    source:
      "import{useState,useEffect}from'react';export default()=>{const[value,set]=useState(0);useEffect(()=>{const timer=setTimeout(()=>set(9),20);return()=>clearTimeout(timer)},[]);return <output data-value={value}/>}",
    expected: 9,
  },
  {
    name: "error recovery",
    source:
      "import{Component}from'react';class Boundary extends Component{state={failed:false};static getDerivedStateFromError(){return{failed:true}}render(){return this.state.failed?<output data-value='caught'/>:this.props.children}}function Child(){throw new Error('child')};export default()=> <Boundary><Child/></Boundary>",
    expected: "caught",
  },
])(
  "executes $name in the engine-owned DOM renderer",
  async ({ source, expected }) => {
    const result = await createRenderer().renderComponent(createSource(source));
    expect(result.diagnostics).toEqual([]);
    expect(result.engine?.status).toBe("complete");
    expect(
      getFibers(result.snapshot.roots).find((fiber) => fiber.name === "output")?.props[
        "data-value"
      ],
    ).toBe(expected);
  },
  60_000,
);

it("executes entry modules and tracks their real React DOM roots", async () => {
  const entry = createSource(
    "import{createRoot}from'react-dom/client';const element=document.createElement('div');document.body.appendChild(element);createRoot(element).render(<main data-value='entry'/>);",
  );
  const result = await createRenderer().renderEntry(entry);
  expect(result.diagnostics).toEqual([]);
  expect(
    getFibers(result.snapshot.roots).find((fiber) => fiber.name === "main")?.props["data-value"],
  ).toBe("entry");
}, 60_000);

it("uses project aliases, JSON modules, defines, and named exports", async () => {
  writeFileSync(resolve(directory, "data.json"), JSON.stringify({ value: 12 }));
  const source = createSource(
    "import data from '@data';export const Named=()=> <output data-value={data.value+process.env.OFFSET}/>;",
  );
  const result = await createRenderer({
    aliases: { "@data": "./data.json" },
    defines: { "process.env.OFFSET": 2 },
  }).renderComponent(source, { exportName: "Named" });
  expect(result.diagnostics).toEqual([]);
  expect(
    getFibers(result.snapshot.roots).find((fiber) => fiber.name === "output")?.props["data-value"],
  ).toBe(14);
}, 60_000);

it("preserves concrete input aliases and cycles without exposing native input objects", async () => {
  const shared = objectValue([]);
  shared.entries.push({ kind: "property", key: "self", value: shared });
  const source = createSource(
    "export default({left,right})=> <output data-value={left===right&&left.self===left}/>;",
  );
  const result = await createRenderer().renderComponent(source, {
    props: objectFromRecord({ left: shared, right: shared }),
  });
  expect(result.diagnostics).toEqual([]);
  expect(
    getFibers(result.snapshot.roots).find((fiber) => fiber.name === "output")?.props["data-value"],
  ).toBe(true);
}, 60_000);

it("does not reuse evaluated modules or globals between production renders", async () => {
  const source = createSource(
    "globalThis.count=(globalThis.count||0)+1;export default()=> <output data-value={globalThis.count}/>;",
  );
  const renderer = createRenderer();
  for (let iteration = 0; iteration < 2; iteration++) {
    const result = await renderer.renderComponent(source);
    expect(result.diagnostics).toEqual([]);
    expect(
      getFibers(result.snapshot.roots).find((fiber) => fiber.name === "output")?.props[
        "data-value"
      ],
    ).toBe(1);
  }
}, 60_000);

it("reports render and cleanup errors without accepting budget-message spoofs", async () => {
  const source = createSource(
    "import{useEffect}from'react';export default()=>{useEffect(()=>()=>{throw new Error('Engine node budget exhausted')},[]);return <output/>}",
  );
  const result = await createRenderer().renderComponent(source);
  expect(result.engine?.status).toBe("failed");
  expect(
    result.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Engine node budget exhausted"),
    ),
  ).toBe(true);
}, 60_000);

it("reports engine exhaustion as incomplete without entering the old interpreter", async () => {
  const source = createSource("export default()=> <output/>;");
  const result = await createRenderer({ maxSteps: 100 }).renderComponent(source);
  expect(result.engine?.status).toBe("incomplete");
  expect(result.snapshot.roots).toEqual([]);
}, 60_000);

it("refuses abstract inputs and legacy callbacks rather than replaying concrete assignments", async () => {
  const source = createSource(
    "throw new Error('application prefix must not run');export default()=>null;",
  );
  const unknown = await createRenderer().renderComponent(source, {
    props: objectFromRecord({ enabled: unknownValue("input") }),
  });
  expect(unknown.engine?.status).toBe("unsupported");
  expect(unknown.diagnostics[0]?.message).toContain("guarded-state port");
  let prepared = false;
  const callback = await createRenderer().renderComponent(source, {
    prepareInterpreter: () => {
      prepared = true;
    },
  });
  expect(callback.engine?.status).toBe("unsupported");
  expect(prepared).toBe(false);
  const produced = await createRenderer().renderWith(() => {
    prepared = true;
    return primitiveValue(null);
  });
  expect(produced.engine?.status).toBe("unsupported");
  expect(prepared).toBe(false);
}, 60_000);

it("uses the production graph's raw and inline asset transforms", async () => {
  writeFileSync(resolve(directory, "content.txt"), "plain text");
  writeFileSync(resolve(directory, "theme.css"), "body{color:red}");
  const filePath = createSource(
    "import text from './content.txt?raw';import css from './theme.css?inline';export default()=> <output data-value={text+css}/>;",
  );
  const result = await createRenderer().renderComponent(filePath);
  expect(result.diagnostics).toEqual([]);
  expect(
    getFibers(result.snapshot.roots).find((fiber) => fiber.name === "output")?.props["data-value"],
  ).toBe("plain textbody{color:red}");
}, 60_000);

it("matches independent native execution of every committed fiber tree", async () => {
  const filePath = createSource(
    "import{useState,useEffect}from'react';export default function Witness(){const[value,setValue]=useState(0);useEffect(()=>setValue(2),[]);return <output data-value={value}/>}",
  );
  const native = await renderNativeEngineWitness(filePath);
  const engine = await createRenderer().renderComponent(filePath);
  expect(native.errors).toEqual([]);
  expect(engine.diagnostics).toEqual([]);
  expect(engine.commits.map((commit) => commit.roots)).toEqual(
    native.commits.map((commit) => commit.roots),
  );
}, 60_000);

it("does not fall back to native modules or the interpreter after a loader refusal", async () => {
  const result = await createRenderer().renderComponent(
    createSource("import fs from 'node:fs';export default()=> <output data-value={!!fs}/>;"),
  );
  expect(result.engine?.status).toBe("unsupported");
  expect(result.diagnostics[0]?.message).toContain("native module");
  expect(result.commits).toEqual([]);
}, 60_000);
