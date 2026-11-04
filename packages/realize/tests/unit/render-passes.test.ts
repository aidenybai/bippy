import { describe, expect, it } from "vite-plus/test";
import { createRenderPassTracker } from "../conformance/verifier/browser/render-passes";

const throwInvalidHookError = (): never => {
  throw new Error("Invalid hook call");
};
const createDispatcher = () => ({ useEffect: () => {}, useCallback: () => {} });
const idleDispatcher = { useEffect: throwInvalidHookError, useCallback: throwInvalidHookError };
const updateDispatcher = createDispatcher();
const rerenderDispatcher = createDispatcher();
const nestedDispatcher = createDispatcher();

const createRender = () => {
  const hits: string[] = [];
  const track = createRenderPassTracker(
    () => hits.length,
    (start, end) => hits.splice(start, end - start),
  );
  const renderPass = (dispatcher: object, [first, ...insideHooks]: string[]): void => {
    track(dispatcher);
    if (first) hits.push(first);
    track(nestedDispatcher);
    hits.push(...insideHooks);
    track(dispatcher);
  };
  return { hits, track, renderPass };
};

describe("render passes", () => {
  it("keeps every hit of a render React runs once, including hits inside hooks", () => {
    const { hits, track, renderPass } = createRender();
    renderPass(updateDispatcher, ["test", "memo"]);
    track(idleDispatcher);
    expect(hits).toEqual(["test", "memo"]);
  });

  it("keeps only the last pass when a render-phase update repeats the render", () => {
    const { hits, track, renderPass } = createRender();
    renderPass(updateDispatcher, ["first", "memo"]);
    renderPass(rerenderDispatcher, ["second", "memo"]);
    renderPass(rerenderDispatcher, ["third", "memo"]);
    track(idleDispatcher);
    expect(hits).toEqual(["third", "memo"]);
  });

  it("keeps hits recorded outside a render", () => {
    const { hits, track, renderPass } = createRender();
    hits.push("handler");
    renderPass(updateDispatcher, ["first"]);
    renderPass(rerenderDispatcher, ["second"]);
    track(idleDispatcher);
    hits.push("effect");
    renderPass(updateDispatcher, ["sibling"]);
    track(null);
    expect(hits).toEqual(["handler", "second", "effect", "sibling"]);
  });
});
