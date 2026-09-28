import { expect, it } from "vitest";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";
import { captureBrowserDOMCounter } from "./helpers/browser-dom-counter.js";

it.each(["production", "development"])(
  "executes React DOM and a guest-owned DOM library: %s",
  async (mode) => {
    const chunk = await buildScriptFixture(
      new URL("./fixtures/concrete-react-dom.ts", import.meta.url),
      mode,
    );
    expect(Object.keys(chunk.modules).some((name) => name.endsWith("linkedom/worker.js"))).toBe(
      true,
    );
    expect(Object.keys(chunk.modules).some((name) => name.includes("react-dom-client"))).toBe(true);
    const runtime = await createConcreteRuntime();
    const native = createNativeRuntime();
    const { api } = await getSymbolicEngine();
    try {
      const failures: unknown[] = [];
      try {
        native.evaluate(chunk.code);
      } catch (error) {
        failures.push(error);
      }
      try {
        runtime.evaluate(chunk.code);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "Native/engine DOM bundle loading failed");
      for (let index = 0; index < 5; index++)
        expect(api.isECMAScriptFunctionObject(runtime.evaluate(`fixture.owned[${index}]`))).toBe(
          true,
        );
      const commands = [
        `mount(${mode === "development"})`,
        "click('increase')",
        "click('step')",
        "click('increase')",
        "click('reset')",
        "click('decrease')",
        "click('toggle')",
        "click('toggle')",
        "unmount()",
      ];
      const observations: string[] = [];
      for (const command of commands) {
        runtime.evaluate(`fixture.${command}`);
        runtime.drainJobs();
        native.evaluate(`fixture.${command}`);
        native.drainJobs();
        const observation = runtime.readString("fixture.observe()");
        observations.push(observation);
        expect(observation, command).toBe(native.evaluate("fixture.observe()"));
        expect(JSON.parse(observation)).toMatchObject({ errors: [] });
      }
      expect(JSON.parse(observations[0]).html).toContain('<output id="count">0</output>');
      expect(JSON.parse(observations[3]).html).toContain('<output id="count">6</output>');
      expect(JSON.parse(observations[7]).html).toContain('<output id="count">-5</output>');
      expect(JSON.parse(observations[8]).html).toBe("");
      expect(
        runtime.consoleEntries.map((entry) => [
          entry.method,
          ...entry.arguments.map((value) => {
            if (value.type !== "String")
              throw new Error("Unexpected non-string DOM console argument");
            return value.value;
          }),
        ]),
      ).toEqual(native.consoleEntries);
      expect(runtime.consoleEntries.every((entry) => entry.method === "info")).toBe(true);
      const browserChunk = await buildScriptFixture(
        new URL("./fixtures/dom-counter.tsx", import.meta.url),
        mode,
      );
      expect(Object.keys(browserChunk.modules).some((name) => name.includes("linkedom"))).toBe(
        false,
      );
      const browser = await captureBrowserDOMCounter(browserChunk.code, commands);
      expect(browser.errors).toEqual([]);
      expect(browser.consoleEntries).toHaveLength(mode === "development" ? 1 : 0);
      expect(browser.observations, `Chromium ${browser.version}`).toEqual(observations);
      expect(
        browser.consoleEntries.every((entry) => entry.method === "info"),
        JSON.stringify(browser.consoleEntries),
      ).toBe(true);
    } finally {
      runtime.dispose();
    }
  },
  30_000,
);
