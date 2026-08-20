import { describe, expect, it, vi } from "vite-plus/test";
import { createConsoleModel } from "../src/console-model.js";
import type { ConsoleModelSettings, ConsoleTarget } from "../src/console-model.js";

const stack = "\n    at Child\n    at Parent";

const createHarness = (
  settings: ConsoleModelSettings = {},
  currentStack: string | null = stack,
) => {
  const target: ConsoleTarget = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
  return {
    model: createConsoleModel({ getCurrentStack: () => currentStack, settings, target }),
    target,
  };
};

describe("upstream component stack behavior", () => {
  it("should log the current component stack along with an error or warning", () => {
    const { model, target } = createHarness();
    model.error("Test error.");
    model.warn("Test warning.");
    expect(target.error).toHaveBeenCalledWith("Test error.", stack);
    expect(target.warn).toHaveBeenCalledWith("Test warning.", stack);
  });

  it("should log the current component stack with debug info from promises", () => {
    const debugStack = "\n    at Child\n    at ServerComponent\n    at Parent";
    const { model, target } = createHarness({}, debugStack);
    model.error("Test error.");
    model.warn("Test warning.");
    expect(target.error).toHaveBeenCalledWith("Test error.", debugStack);
    expect(target.warn).toHaveBeenCalledWith("Test warning.", debugStack);
  });
});

describe("upstream console integration behavior", () => {
  it("should pass through logs when there is no current fiber", () => {
    const { model, target } = createHarness({}, null);
    model.error("error");
    expect(target.error).toHaveBeenCalledWith("error");
  });

  it("should not append multiple stacks", () => {
    const { model, target } = createHarness();
    model.error("error", stack);
    expect(target.error).toHaveBeenCalledWith("error", stack);
  });

  it("should append component stacks to errors and warnings logged during render", () => {
    const { model, target } = createHarness();
    model.error("error");
    model.warn("warning");
    expect(target.error).toHaveBeenCalledWith("error", stack);
    expect(target.warn).toHaveBeenCalledWith("warning", stack);
  });

  it("should append component stacks to errors and warnings logged from effects", () => {
    const { model, target } = createHarness();
    model.warn("effect");
    expect(target.warn).toHaveBeenCalledWith("effect", stack);
  });

  it("should append component stacks to errors and warnings logged from commit hooks", () => {
    const { model, target } = createHarness();
    model.error("commit");
    expect(target.error).toHaveBeenCalledWith("commit", stack);
  });

  it("should append component stacks to errors and warnings logged from gDSFP", () => {
    const { model, target } = createHarness();
    model.error("derived");
    expect(target.error).toHaveBeenCalledWith("derived", stack);
  });

  it("should be resilient to prepareStackTrace", () => {
    const { model, target } = createHarness({}, null);
    expect(() => model.error(new Error("error"))).not.toThrow();
    expect(target.error).toHaveBeenCalledOnce();
  });

  it("should correctly log Symbols", () => {
    const { model, target } = createHarness();
    const symbol = Symbol("value");
    model.error(symbol);
    expect(target.error).toHaveBeenCalledWith(symbol, stack);
  });

  it("should double log if hideConsoleLogsInStrictMode is disabled in Strict mode", () => {
    const { model, target } = createHarness({ disableSecondLogDimming: true });
    model.log("render");
    model.runStrictSecondPass(() => model.log("render"));
    expect(target.log).toHaveBeenCalledTimes(2);
  });

  it("should not double log if hideConsoleLogsInStrictMode is enabled in Strict mode", () => {
    const { model, target } = createHarness({ hideStrictModeLogs: true });
    model.log("render");
    model.runStrictSecondPass(() => model.log("render"));
    expect(target.log).toHaveBeenCalledOnce();
  });

  it("should double log from Effects if hideConsoleLogsInStrictMode is disabled in Strict mode", () => {
    const { model, target } = createHarness({ disableSecondLogDimming: true });
    model.warn("effect");
    model.runStrictSecondPass(() => model.warn("effect"));
    expect(target.warn).toHaveBeenCalledTimes(2);
  });

  it("should not double log from Effects if hideConsoleLogsInStrictMode is enabled in Strict mode", () => {
    const { model, target } = createHarness({ hideStrictModeLogs: true });
    model.warn("effect");
    model.runStrictSecondPass(() => model.warn("effect"));
    expect(target.warn).toHaveBeenCalledOnce();
  });

  it("should double log from useMemo if hideConsoleLogsInStrictMode is disabled in Strict mode", () => {
    const { model, target } = createHarness({ disableSecondLogDimming: true });
    model.log("memo");
    model.runStrictSecondPass(() => model.log("memo"));
    expect(target.log).toHaveBeenCalledTimes(2);
  });

  it("should not double log from useMemo fns if hideConsoleLogsInStrictMode is enabled in Strict mode", () => {
    const { model, target } = createHarness({ hideStrictModeLogs: true });
    model.log("memo");
    model.runStrictSecondPass(() => model.log("memo"));
    expect(target.log).toHaveBeenCalledOnce();
  });

  it("should double log in Strict mode initial render for extension", () => {
    const { model, target } = createHarness({ disableSecondLogDimming: true });
    model.error("initial");
    model.runStrictSecondPass(() => model.error("initial"));
    expect(target.error).toHaveBeenCalledTimes(2);
  });

  it("should not double log in Strict mode initial render for extension", () => {
    const { model, target } = createHarness({ hideStrictModeLogs: true });
    model.error("initial");
    model.runStrictSecondPass(() => model.error("initial"));
    expect(target.error).toHaveBeenCalledOnce();
  });

  it("should properly dim component stacks during strict mode double log", () => {
    const { model, target } = createHarness();
    model.runStrictSecondPass(() => model.error("error"));
    expect(target.error).toHaveBeenCalledWith("%c", expect.any(String), "error", stack);
  });

  it("should not dim console logs if disableSecondConsoleLogDimmingInStrictMode is enabled", () => {
    const { model, target } = createHarness({ disableSecondLogDimming: true });
    model.runStrictSecondPass(() => model.log("log"));
    expect(target.log).toHaveBeenCalledWith("log");
  });

  it("should dim console logs if disableSecondConsoleLogDimmingInStrictMode is disabled", () => {
    const { model, target } = createHarness();
    model.runStrictSecondPass(() => model.log("log"));
    expect(target.log).toHaveBeenCalledWith("%c", expect.any(String), "log");
  });
});
