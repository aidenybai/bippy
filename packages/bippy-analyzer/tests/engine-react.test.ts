import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import { renderNativeEngineWitness } from "../src/corpus/native-engine-renderer.js";
import { createEngineProject, getHostText } from "./helpers/engine-renderer.js";

interface ReactCase {
  name: string;
  text: string;
  trace: string[];
  selector?: string;
  input?: string;
}

const { directory, createSource, createRenderer } = createEngineProject();
cpSync(resolve(import.meta.dirname, "fixtures/engine-renderer"), resolve(directory, "fixtures"), { recursive: true });

const cases: ReactCase[] = [
  { name: "async-counter", text: "5:3", trace: ["effect:2", "timer", "promise:3", "cleanup:3"] },
  { name: "async-await", text: "3:expected", trace: ["before", "timer", "caught:expected", "finally", "cleanup:3"] },
  { name: "loop-cleanup", text: "0,1,2:body", trace: ["next", "body:7", "close"] },
  { name: "bigint", text: "true:9:3", trace: [] },
  { name: "hook-identity", text: "count:1:true:2", trace: ["effect:0", "cleanup:0", "effect:1", "cleanup:1"] },
  { name: "descriptors", text: "mutated:label,value", trace: ["receiver"] },
  { name: "nested-components", text: "nested", trace: ["child:mount", "child:cleanup"] },
  { name: "prop-identity", text: "true:true:3:true:true:truechild", trace: ["child:2", "child:3"] },
  { name: "context-reducer", text: "5:true", trace: ["init:2"] },
  { name: "memo-children", text: "true:2stable", trace: ["child:render"] },
  { name: "external-store", text: "7", trace: ["subscribe", "unsubscribe"] },
  { name: "bundled-modules", text: "3", trace: [] },
  { name: "class-lifecycle", text: "counter:2:private", selector: "button", trace: [
    "construct:counter", "derive:0", "render:0", "mount:provided:private", "derive:1", "should:1", "render:1", "snapshot:0", "update:from:0:1", "callback:1", "derive:2", "should:2", "render:2", "snapshot:1", "update:from:1:2", "unmount:private:2",
  ] },
  { name: "lazy-suspense", text: "ready", trace: ["load", "fallback:effect", "module", "data", "content:layout", "fallback:cleanup", "content:cleanup"] },
  { name: "input-event", text: "hello", selector: "input", input: "hello", trace: ["change:true:hello"] },
  { name: "events-refs", text: "readready", selector: "button", trace: ["layout", "click:BUTTON:true", "after:true:BUTTON", "cleanup"] },
];

it.each(cases)("runs $name and its cleanup assertions through actual React DOM", async ({ name, text, trace, selector, input }) => {
  const filePath = createSource(`
    import {useEffect} from 'react';
    import * as fixture from './fixtures/${name}.tsx';
    const Component=fixture.default;
    export default () => {
      useEffect(() => {
        ${selector ? `setTimeout(() => {
          const target=document.querySelector(${JSON.stringify(selector)});
          if(!target) throw new Error('Missing interaction target');
          ${input !== undefined ? `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target),'value').set.call(target,${JSON.stringify(input)});` : ""}
          target.dispatchEvent(new ${input === undefined ? "MouseEvent" : "Event"}(${JSON.stringify(input === undefined ? "click" : "input")},{bubbles:true,cancelable:true}));
        },1);` : ""}
        return () => queueMicrotask(() => {
          const trace=typeof fixture.getTrace==='function'?fixture.getTrace():[];
          if(JSON.stringify(trace)!==${JSON.stringify(JSON.stringify(trace))}) throw new Error('Unexpected lifecycle trace: '+JSON.stringify(trace));
        });
      },[]);
      return <Component/>;
    };
  `);
  const native = await renderNativeEngineWitness(filePath);
  const engine = await createRenderer().renderComponent(filePath);
  expect(native.errors).toEqual([]);
  expect(engine.diagnostics).toEqual([]);
  expect(engine.engine?.status).toBe("complete");
  expect(engine.engine?.bundleHash).toBe(native.bundleHash);
  expect(engine.commits.map((commit) => commit.roots)).toEqual(native.commits.map((commit) => commit.roots));
  expect(getHostText(engine.snapshot.roots)).toBe(text);
}, 60_000);

it.each(["module", "microtask"])("reports %s failures from application code", async (phase) => {
  const failure = "throw new TypeError('application failure')";
  const filePath = createSource(`${phase === "module" ? failure : `queueMicrotask(()=>{${failure}})`}; export default()=> <p>pending</p>;`);
  await expect(renderNativeEngineWitness(filePath)).rejects.toThrow("application failure");
  const result = await createRenderer().renderComponent(filePath);
  expect(result.engine?.status).toBe("failed");
  expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("application failure"))).toBe(true);
},60_000);

it("uses actual React element construction and engine-owned callback identity", async () => {
  const filePath = createSource(`
    import {createElement,isValidElement} from 'react';
    const callback=()=>{};const element=createElement('button',{onClick:callback},'click');
    if(!isValidElement(element)||element.props.onClick!==callback||!Object.isFrozen(element.props)) throw new Error('React element identity');
    export default()=>element;
  `);
  const result = await createRenderer().renderComponent(filePath);
  expect(result.engine?.status).toBe("complete");
  expect(result.diagnostics).toEqual([]);
},60_000);
