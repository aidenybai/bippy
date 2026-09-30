import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

it("identifies the original bound-call implementation used by actual React dispatch", async () => {
  const runtime = await createConcreteRuntime();
  const native = createNativeRuntime();
  const { api } = await getSymbolicEngine();
  const source = (
    await buildScriptFixture(
      new URL("./fixtures/native-origin-react.tsx", import.meta.url),
      "production",
    )
  ).code;
  const run = (command: string) => {
    runtime.evaluate(`fixture.${command}()`);
    runtime.drainJobs();
    native.evaluate(`fixture.${command}()`);
    native.drainJobs();
    const snapshot = runtime.readString("fixture.observe()");
    expect(snapshot).toBe(native.evaluate("fixture.observe()"));
    return JSON.parse(snapshot);
  };
  try {
    runtime.evaluate(source);
    native.evaluate(source);
    expect(run("mount")).toEqual({ type: "output", props: {}, children: ["0"] });
    const dispatch = runtime.evaluate("fixture.getDispatch()");
    if (!api.isBoundFunctionObject(dispatch)) throw new Error("Expected bound dispatch");
    expect(api.getNativeSourceModule(dispatch)).toBeUndefined();
    expect(api.getNativeSourceModule(dispatch.Call)).toBe(
      "engine262/src/intrinsics/FunctionPrototype.mts",
    );
    expect(run("increment")).toEqual({ type: "output", props: {}, children: ["1"] });
    expect(runtime.evaluate("fixture.getDispatch()") === dispatch).toBe(true);
    expect(run("unmount")).toBeNull();
  } finally {
    runtime.dispose();
  }
});
