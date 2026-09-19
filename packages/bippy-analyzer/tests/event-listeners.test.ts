import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { callEventTargetMethod } from "../src/evaluate/event-listeners.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import { nativeObjectValue, primitiveValue, UNDEFINED_VALUE } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

it("allows finite reentrant dispatch of custom native events", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: import.meta.dirname });
  await renderer.renderWith((interpreter) => {
    const module = interpreter.graph.addVirtualModule(join(import.meta.dirname, "events.ts"), "");
    if (!module) throw new Error("Missing event module");
    const context = interpreter.createModuleContext(module);
    const target = new EventTarget();
    let calls = 0;
    const listener = nativeFunction("listener", () => {
      calls++;
      if (calls < 3) target.dispatchEvent(new Event("custom-event"));
      return UNDEFINED_VALUE;
    });
    callEventTargetMethod(
      interpreter,
      interpreter.getRealm(null),
      nativeObjectValue(target, null),
      "addEventListener",
      [primitiveValue("custom-event"), listener],
      context,
      null,
    );
    target.dispatchEvent(new Event("custom-event"));
    expect(calls).toBe(3);
    return UNDEFINED_VALUE;
  });
});
