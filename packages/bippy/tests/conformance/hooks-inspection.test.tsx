import * as React from "react";
import "react-dom/client";
import { inspectHooks, type HooksNode } from "bippy/source";
import { describe, expect, it } from "vite-plus/test";

interface FulfilledPromiseFields {
  status: "fulfilled";
  value: string;
  _debugInfo: Array<{ name: string }>;
}

interface ExpectedHook {
  name: string;
  value?: unknown;
  id?: number | null;
  functionName?: string | null;
  subHooks?: HooksNode[];
  debugInfo?: HooksNode["debugInfo"];
}

const hook = ({
  name,
  value,
  id = null,
  functionName = "Component",
  subHooks = [],
  debugInfo = null,
}: ExpectedHook): HooksNode => ({
  name,
  value,
  id,
  subHooks,
  debugInfo,
  isStateEditable: id !== null && (name === "State" || name === "Reducer"),
  hookSource: { fileName: "**", lineNumber: 0, columnNumber: 0, functionName },
});

const normalizeSourceLocations = (tree: HooksNode[]): HooksNode[] =>
  tree.map((node) => ({
    ...node,
    hookSource: node.hookSource
      ? { ...node.hookSource, fileName: "**", lineNumber: 0, columnNumber: 0 }
      : null,
    subHooks: normalizeSourceLocations(node.subHooks),
  }));

// Adapted from all 11 cases in ReactHooksInspection-test.js. See ../NOTICE and ../upstream.json.
describe("ReactHooksInspection upstream ports", () => {
  it("should inspect a simple useState hook", () => {
    const Component = () => {
      const [state] = React.useState("hello world");
      return <div>{state}</div>;
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({ name: "State", value: "hello world", id: 0 }),
    ]);
  });

  it("should inspect a simple custom hook", () => {
    const useCustom = (value: string) => {
      const [state] = React.useState(value);
      React.useDebugValue("custom hook label");
      return state;
    };
    const Component = () => <div>{useCustom("hello world")}</div>;
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({
        name: "Custom",
        value: "custom hook label",
        subHooks: [hook({ name: "State", value: "hello world", id: 0, functionName: "useCustom" })],
      }),
    ]);
  });

  it("should inspect a tree of multiple hooks", () => {
    const effect = () => {};
    const useCustom = (value: string) => {
      const [state] = React.useState(value);
      React.useEffect(effect);
      return state;
    };
    const Component = () => {
      const firstValue = useCustom("hello");
      const secondValue = useCustom("world");
      return (
        <div>
          {firstValue} {secondValue}
        </div>
      );
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual(
      ["hello", "world"].map((value, index) =>
        hook({
          name: "Custom",
          subHooks: [
            hook({ name: "State", value, id: index * 2, functionName: "useCustom" }),
            hook({ name: "Effect", value: effect, id: index * 2 + 1, functionName: "useCustom" }),
          ],
        }),
      ),
    );
  });

  it("should inspect a tree of multiple levels of hooks", () => {
    const effect = () => {};
    const useCustom = (value: string) => {
      const [state] = React.useReducer((state: string) => state, value);
      React.useEffect(effect);
      return state;
    };
    const useBar = (value: string) => {
      const result = useCustom(value);
      React.useLayoutEffect(effect);
      return result;
    };
    const useBaz = (value: string) => {
      React.useLayoutEffect(effect);
      return useCustom(value);
    };
    const Component = () => {
      const firstValue = useBar("hello");
      const secondValue = useBaz("world");
      return (
        <div>
          {firstValue} {secondValue}
        </div>
      );
    };
    const custom = (value: string, id: number, functionName: string) =>
      hook({
        name: "Custom",
        functionName,
        subHooks: [
          hook({ name: "Reducer", value, id, functionName: "useCustom" }),
          hook({ name: "Effect", value: effect, id: id + 1, functionName: "useCustom" }),
        ],
      });
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({
        name: "Bar",
        subHooks: [
          custom("hello", 0, "useBar"),
          hook({ name: "LayoutEffect", value: effect, id: 2, functionName: "useBar" }),
        ],
      }),
      hook({
        name: "Baz",
        subHooks: [
          hook({ name: "LayoutEffect", value: effect, id: 3, functionName: "useBaz" }),
          custom("world", 4, "useBaz"),
        ],
      }),
    ]);
  });

  it("should not confuse built-in hooks with custom hooks that have the same name", () => {
    const useState = (value: string) => {
      React.useState(value);
      React.useDebugValue("custom useState");
    };
    const useFormStatus = () => {
      React.useState("custom useState");
      React.useDebugValue("custom useFormStatus");
    };
    const Component = () => {
      useFormStatus();
      useState("Hello, Dave!");
      return null;
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({
        name: "FormStatus",
        value: "custom useFormStatus",
        subHooks: [
          hook({ name: "State", value: "custom useState", id: 0, functionName: "useFormStatus" }),
        ],
      }),
      hook({
        name: "State",
        value: "custom useState",
        subHooks: [hook({ name: "State", value: "Hello, Dave!", id: 1, functionName: "useState" })],
      }),
    ]);
  });

  it("should inspect the default value using the useContext hook", () => {
    const Context = React.createContext("default");
    const Component = () => <div>{React.useContext(Context)}</div>;
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({ name: "Context", value: "default" }),
    ]);
  });

  it("should inspect use() calls for Promise and Context", async () => {
    const Context = React.createContext("hi");
    const promise = Object.assign(Promise.resolve("world"), {
      status: "fulfilled",
      value: "world",
      _debugInfo: [{ name: "Hello" }],
    } satisfies FulfilledPromiseFields);
    await promise;
    const useCustom = () => {
      const value = React.use(promise);
      const [state] = React.useState(value);
      return state;
    };
    const Component = () => {
      const firstValue = React.use(Context);
      const secondValue = useCustom();
      return (
        <div>
          {firstValue} {secondValue}
        </div>
      );
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({ name: "Context", value: "hi" }),
      hook({
        name: "Custom",
        subHooks: [
          hook({
            name: "Use",
            value: "world",
            functionName: "useCustom",
            debugInfo: [{ name: "Hello" }],
          }),
          hook({ name: "State", value: "world", id: 0, functionName: "useCustom" }),
        ],
      }),
    ]);
  });

  it("should inspect use() calls for unresolved Promise", () => {
    const promise = Promise.resolve("hi");
    const Component = () => <div>{React.use(promise)}</div>;
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({ name: "Use", value: promise }),
    ]);
  });

  it("should inspect use() calls in anonymous loops", () => {
    const entries = { one: Promise.resolve("one"), two: Promise.resolve("two") };
    const Component = () => {
      Object.entries(entries).map(([key, value]) => [key, React.use(value)]);
      return null;
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({ name: "", subHooks: [hook({ name: "Use", value: entries.one, functionName: null })] }),
    ]);
  });

  it("should be ignored when called outside of a custom hook", () => {
    const Component = () => {
      React.useDebugValue("this is invalid");
      return null;
    };
    expect(inspectHooks(Component, {})).toEqual([]);
  });

  it("should support an optional formatter function param", () => {
    const useCustom = () => {
      React.useDebugValue({ bar: 123 }, (value) => `bar:${value.bar}`);
      React.useState(0);
    };
    const Component = () => {
      useCustom();
      return null;
    };
    expect(normalizeSourceLocations(inspectHooks(Component, {}))).toEqual([
      hook({
        name: "Custom",
        value: "bar:123",
        subHooks: [hook({ name: "State", value: 0, id: 0, functionName: "useCustom" })],
      }),
    ]);
  });
});
