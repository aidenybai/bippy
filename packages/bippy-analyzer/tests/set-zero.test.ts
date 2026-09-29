import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";

it.each([
  "var target=new Set([-0]);",
  "var target=new Set();target.add(-0);",
  "var target=new Set([-0]);target.add(0);target.add(-0);",
  "var target=new Set([0]);target.delete(-0);target.add(-0);",
])("canonicalizes Set zero for %s", async (setup) => {
  const source = `${setup}
    var callbacks=[];target.forEach((value,key)=>callbacks.push([Object.is(value,0),Object.is(key,0)]));
    JSON.stringify([target.size,Object.is(target.values().next().value,0),Object.is(target.keys().next().value,0),Array.from(target.entries(),pair=>pair.map(value=>Object.is(value,0))),callbacks]);
  `;
  await withFixture(({ readString }) => {
    expect(readString(source)).toBe(runInNewContext(source));
  });
});
