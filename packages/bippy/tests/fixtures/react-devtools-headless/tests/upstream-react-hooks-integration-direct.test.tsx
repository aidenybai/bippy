// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import * as ReactTestRenderer from "react-test-renderer";
import { c as useMemoCache } from "react/compiler-runtime";
import { describe, expect, it } from "vite-plus/test";
import { getFiberHooks } from "bippy/source";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDebugTools = { inspectHooksOfFiber: getFiberHooks };
const act = ReactTestRenderer.act;
const __DEV__ = true;
expect.extend({
  toMatchRenderedOutput(renderer, expected) {
    const output = renderer.toJSON();
    const received = Array.isArray(output) ? output.join("") : output;
    return {
      message: () =>
        `expected ${this.utils.printReceived(received)} to equal ${this.utils.printExpected(expected)}`,
      pass: this.equals(received, expected),
    };
  },
});

const normalizeSourceLoc = (tree) => {
  tree.forEach((node) => {
    if (node.hookSource) {
      node.hookSource.fileName = "**";
      node.hookSource.lineNumber = 0;
      node.hookSource.columnNumber = 0;
    }
    normalizeSourceLoc(node.subHooks);
  });
  return tree;
};

describe("ReactHooksInspectionIntegration", () => {
  it("should inspect the current state of useState hooks", async () => {
    const useState = React.useState;
    const Foo = (_props) => {
      const [state1, setState1] = useState("hello");
      const [state2, setState2] = useState("world");
      return (
        <div onMouseDown={setState1} onMouseUp={setState2}>
          {state1} {state2}
        </div>
      );
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo prop="prop" />, {
        unstable_isConcurrent: true,
      });
    });
    let childFiber = renderer.root.findByType(Foo)._currentFiber();
    let tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "world",
        },
      ]
    `);
    const { onMouseDown: setStateA, onMouseUp: setStateB } = renderer.root.findByType("div").props;
    await act(() => setStateA("Hi"));
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "Hi",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "world",
        },
      ]
    `);
    await act(() => setStateB("world!"));
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "Hi",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "world!",
        },
      ]
    `);
  });
  it("should inspect the current state of all stateful hooks", async () => {
    const outsideRef = React.createRef();
    const effect = () => {};
    const Foo = (_props) => {
      const [state1, setState] = React.useState("a");
      const [state2, dispatch] = React.useReducer((s, a) => a.value, "b");
      const ref = React.useRef("c");
      React.useLayoutEffect(effect);
      React.useEffect(effect);
      React.useImperativeHandle(outsideRef, () => {
        return () => {};
      }, []);
      React.useMemo(() => state1 + state2, [state1]);
      const update = () => {
        setState("A");
        dispatch({
          value: "B",
        });
        ref.current = "C";
      };
      const memoizedUpdate = React.useCallback(update, []);
      return (
        <div onClick={memoizedUpdate}>
          {state1} {state2}
        </div>
      );
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo prop="prop" />, {
        unstable_isConcurrent: true,
      });
    });
    let childFiber = renderer.root.findByType(Foo)._currentFiber();
    const { onClick: updateStates } = renderer.root.findByType("div").props;
    let tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "a",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "Reducer",
          "subHooks": [],
          "value": "b",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Ref",
          "subHooks": [],
          "value": "c",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "LayoutEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 4,
          "isStateEditable": false,
          "name": "Effect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 5,
          "isStateEditable": false,
          "name": "ImperativeHandle",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 6,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "ab",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 7,
          "isStateEditable": false,
          "name": "Callback",
          "subHooks": [],
          "value": [Function],
        },
      ]
    `);
    await act(() => {
      updateStates();
    });
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "A",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "Reducer",
          "subHooks": [],
          "value": "B",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Ref",
          "subHooks": [],
          "value": "C",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "LayoutEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 4,
          "isStateEditable": false,
          "name": "Effect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 5,
          "isStateEditable": false,
          "name": "ImperativeHandle",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 6,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "AB",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 7,
          "isStateEditable": false,
          "name": "Callback",
          "subHooks": [],
          "value": [Function],
        },
      ]
    `);
  });
  it("should inspect the current state of all stateful hooks, including useInsertionEffect", async () => {
    const useInsertionEffect = React.useInsertionEffect;
    const outsideRef = React.createRef();
    const effect = () => {};
    const Foo = (_props) => {
      const [state1, setState] = React.useState("a");
      const [state2, dispatch] = React.useReducer((s, a) => a.value, "b");
      const ref = React.useRef("c");
      useInsertionEffect(effect);
      React.useLayoutEffect(effect);
      React.useEffect(effect);
      React.useImperativeHandle(outsideRef, () => {
        return () => {};
      }, []);
      React.useMemo(() => state1 + state2, [state1]);
      const update = async () => {
        setState("A");
        dispatch({
          value: "B",
        });
        ref.current = "C";
      };
      const memoizedUpdate = React.useCallback(update, []);
      return (
        <div onClick={memoizedUpdate}>
          {state1} {state2}
        </div>
      );
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo prop="prop" />, {
        unstable_isConcurrent: true,
      });
    });
    let childFiber = renderer.root.findByType(Foo)._currentFiber();
    const { onClick: updateStates } = renderer.root.findByType("div").props;
    let tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "a",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "Reducer",
          "subHooks": [],
          "value": "b",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Ref",
          "subHooks": [],
          "value": "c",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "InsertionEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 4,
          "isStateEditable": false,
          "name": "LayoutEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 5,
          "isStateEditable": false,
          "name": "Effect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 6,
          "isStateEditable": false,
          "name": "ImperativeHandle",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 7,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "ab",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 8,
          "isStateEditable": false,
          "name": "Callback",
          "subHooks": [],
          "value": [Function],
        },
      ]
    `);
    await act(() => {
      updateStates();
    });
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "A",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": true,
          "name": "Reducer",
          "subHooks": [],
          "value": "B",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Ref",
          "subHooks": [],
          "value": "C",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "InsertionEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 4,
          "isStateEditable": false,
          "name": "LayoutEffect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 5,
          "isStateEditable": false,
          "name": "Effect",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 6,
          "isStateEditable": false,
          "name": "ImperativeHandle",
          "subHooks": [],
          "value": [Function],
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 7,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "AB",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 8,
          "isStateEditable": false,
          "name": "Callback",
          "subHooks": [],
          "value": [Function],
        },
      ]
    `);
  });
  it("should inspect the value of the current provider in useContext", async () => {
    const MyContext = React.createContext("default");
    const ThemeContext = React.createContext("default");
    ThemeContext.displayName = "Theme";
    const Foo = (_props) => {
      const value = React.useContext(MyContext);
      React.useContext(ThemeContext);
      return <div>{value}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <MyContext.Provider value="contextual">
          <Foo prop="prop" />
        </MyContext.Provider>,
        {
          unstable_isConcurrent: true,
        },
      );
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Context",
          "subHooks": [],
          "value": "contextual",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Theme",
          "subHooks": [],
          "value": "default",
        },
      ]
    `);
  });
  it("should inspect the value of the current provider in useContext reading the same context multiple times", async () => {
    const ContextA = React.createContext("default A");
    const ContextB = React.createContext("default B");
    const Foo = (_props) => {
      React.useContext(ContextA);
      React.useContext(ContextA);
      React.useContext(ContextB);
      React.useContext(ContextB);
      React.useContext(ContextA);
      React.useContext(ContextB);
      React.useContext(ContextB);
      React.useContext(ContextB);
      return null;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <ContextA.Provider value="contextual A">
          <Foo prop="prop" />
        </ContextA.Provider>,
        {
          unstable_isConcurrent: true,
        },
      );
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toEqual([
      expect.objectContaining({
        value: "contextual A",
      }),
      expect.objectContaining({
        value: "contextual A",
      }),
      expect.objectContaining({
        value: "default B",
      }),
      expect.objectContaining({
        value: "default B",
      }),
      expect.objectContaining({
        value: "contextual A",
      }),
      expect.objectContaining({
        value: "default B",
      }),
      expect.objectContaining({
        value: "default B",
      }),
      expect.objectContaining({
        value: "default B",
      }),
    ]);
  });
  it("should inspect forwardRef", async () => {
    const obj = () => {};
    const Foo = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => obj);
      return <div />;
    });
    const ref = React.createRef();
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo ref={ref} />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": null,
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "ImperativeHandle",
          "subHooks": [],
          "value": [Function],
        },
      ]
    `);
  });
  it("should inspect memo", async () => {
    const InnerFoo = (_props) => {
      const [value] = React.useState("hello");
      return <div>{value}</div>;
    };
    const Foo = React.memo(InnerFoo);
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(InnerFoo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "InnerFoo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": "hello",
        },
      ]
    `);
  });
  it("should inspect custom hooks", async () => {
    const useCustom = () => {
      const [value] = React.useState("hello");
      return value;
    };
    const Foo = (_props) => {
      const value = useCustom();
      return <div>{value}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Custom",
          "subHooks": [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useCustom",
                "lineNumber": 0,
              },
              "id": 0,
              "isStateEditable": true,
              "name": "State",
              "subHooks": [],
              "value": "hello",
            },
          ],
          "value": undefined,
        },
      ]
    `);
  });
  it("should support composite useTransition hook", async () => {
    const Foo = (_props) => {
      React.useTransition();
      const memoizedValue = React.useMemo(() => "hello", []);
      React.useMemo(() => "not used", []);
      return <div>{memoizedValue}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "Transition",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should update isPending returned from useTransition", async () => {
    const IndefiniteSuspender = React.lazy(() => new Promise(() => {}));
    let startTransition;
    const Foo = (_props) => {
      const [show, setShow] = React.useState(false);
      const [isPending, _startTransition] = React.useTransition();
      React.useMemo(() => "hello", []);
      React.useMemo(() => "not used", []);
      if (startTransition === undefined) {
        startTransition = () => {
          _startTransition(() => {
            setShow(true);
          });
        };
      }
      return (
        <React.Suspense fallback="Loading">
          {isPending ? "Pending" : null}
          {show ? <IndefiniteSuspender /> : null}
        </React.Suspense>
      );
    };
    const renderer = await act(() => {
      return ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    expect(renderer).toMatchRenderedOutput(null);
    let childFiber = renderer.root.findByType(Foo)._currentFiber();
    let tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Transition",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
    await act(() => {
      startTransition();
    });
    expect(renderer).toMatchRenderedOutput("Pending");
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Transition",
          "subHooks": [],
          "value": true,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should support useDeferredValue hook", async () => {
    const Foo = (_props) => {
      React.useDeferredValue("abc");
      const memoizedValue = React.useMemo(() => 1, []);
      React.useMemo(() => 2, []);
      return <div>{memoizedValue}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "DeferredValue",
          "subHooks": [],
          "value": "abc",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": 1,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": 2,
        },
      ]
    `);
  });
  it("should return the deferred value", async () => {
    let unsuspend;
    const Lazy = () => {
      return "Lazy";
    };
    const Suspender = React.lazy(
      () =>
        new Promise((resolve) => {
          unsuspend = () =>
            resolve({
              default: Lazy,
            });
        }),
    );
    const Context = React.createContext("default");
    let setShow;
    const Foo = (_props) => {
      const [show, _setShow] = React.useState(false);
      const deferredShow = React.useDeferredValue(show);
      const isPending = show !== deferredShow;
      const contextDisplay = isPending ? React.use(Context) : "<none>";
      React.useMemo(() => "hello", []);
      React.useMemo(() => "not used", []);
      if (setShow === undefined) {
        setShow = _setShow;
      }
      return (
        <React.Suspense fallback="Loading">
          Context: {contextDisplay}, {isPending ? "Pending" : "Nothing Pending"}
          {deferredShow ? [", ", <Suspender key="suspender" />] : null}
        </React.Suspense>
      );
    };
    const renderer = await act(() => {
      return ReactTestRenderer.create(
        <Context.Provider value="provided">
          <Foo />
        </Context.Provider>,
        {
          unstable_isConcurrent: true,
        },
      );
    });
    let childFiber = renderer.root.findByType(Foo)._currentFiber();
    let tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(renderer).toMatchRenderedOutput("Context: <none>, Nothing Pending");
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "DeferredValue",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
    await act(() => {
      setShow(true);
    });
    expect(renderer).toMatchRenderedOutput("Context: provided, Pending");
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": true,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "DeferredValue",
          "subHooks": [],
          "value": false,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Context",
          "subHooks": [],
          "value": "provided",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
    await act(() => {
      unsuspend();
    });
    expect(renderer).toMatchRenderedOutput("Context: <none>, Nothing Pending, Lazy");
    childFiber = renderer.root.findByType(Foo)._currentFiber();
    tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": true,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "DeferredValue",
          "subHooks": [],
          "value": true,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "hello",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 3,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should support useId hook", async () => {
    const Foo = (_props) => {
      const id = React.useId();
      const [state] = React.useState("hello");
      return <div id={id}>{state}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(tree.length).toEqual(2);
    expect(tree[0].id).toEqual(0);
    expect(tree[0].isStateEditable).toEqual(false);
    expect(tree[0].name).toEqual("Id");
    expect(String(tree[0].value).startsWith("_r_")).toBe(true);
    expect(normalizeSourceLoc(tree)[1]).toMatchInlineSnapshot(`
      {
        "debugInfo": null,
        "hookSource": {
          "columnNumber": 0,
          "fileName": "**",
          "functionName": "Foo",
          "lineNumber": 0,
        },
        "id": 1,
        "isStateEditable": true,
        "name": "State",
        "subHooks": [],
        "value": "hello",
      }
    `);
  });
  describe("useMemoCache", () => {
    it("should not be inspectable", async () => {
      const Foo = () => {
        const $ = useMemoCache(1);
        let t0;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t0 = <div>{1}</div>;
          $[0] = t0;
        } else {
          t0 = $[0];
        }
        return t0;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Foo />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Foo)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      expect(tree.length).toEqual(0);
    });
    it("should work in combination with other hooks", async () => {
      const useSomething = () => {
        const [something] = React.useState(null);
        const changeOtherSomething = React.useCallback(() => {}, [something]);
        return [something, changeOtherSomething];
      };
      const Foo = () => {
        const $ = useMemoCache(10);
        useSomething();
        React.useState(1);
        React.useEffect(() => {});
        let t0;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t0 = <div>{1}</div>;
          $[0] = t0;
        } else {
          t0 = $[0];
        }
        return t0;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Foo />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Foo)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      expect(tree.length).toEqual(3);
    });
  });
  describe("useDebugValue", () => {
    it("should support inspectable values for multiple custom hooks", async () => {
      const useLabeledValue = (label) => {
        const [value] = React.useState(label);
        React.useDebugValue(`custom label ${label}`);
        return value;
      };
      const useAnonymous = (label) => {
        const [value] = React.useState(label);
        return value;
      };
      const Example = () => {
        useLabeledValue("a");
        React.useState("b");
        useAnonymous("c");
        useLabeledValue("d");
        return null;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Example />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Example)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      if (__DEV__) {
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "LabeledValue",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useLabeledValue",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "a",
                },
              ],
              "value": "custom label a",
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": 1,
              "isStateEditable": true,
              "name": "State",
              "subHooks": [],
              "value": "b",
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Anonymous",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useAnonymous",
                    "lineNumber": 0,
                  },
                  "id": 2,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "c",
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "LabeledValue",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useLabeledValue",
                    "lineNumber": 0,
                  },
                  "id": 3,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "d",
                },
              ],
              "value": "custom label d",
            },
          ]
        `);
      } else
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "LabeledValue",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useLabeledValue",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "a",
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": 1,
              "isStateEditable": true,
              "name": "State",
              "subHooks": [],
              "value": "b",
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Anonymous",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useAnonymous",
                    "lineNumber": 0,
                  },
                  "id": 2,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "c",
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "LabeledValue",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useLabeledValue",
                    "lineNumber": 0,
                  },
                  "id": 3,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": "d",
                },
              ],
              "value": undefined,
            },
          ]
        `);
    });
    it("should support inspectable values for nested custom hooks", async () => {
      const useInner = () => {
        React.useDebugValue("inner");
        React.useState(0);
      };
      const useOuter = () => {
        React.useDebugValue("outer");
        useInner();
      };
      const Example = () => {
        useOuter();
        return null;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Example />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Example)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      if (__DEV__) {
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Outer",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useOuter",
                    "lineNumber": 0,
                  },
                  "id": null,
                  "isStateEditable": false,
                  "name": "Inner",
                  "subHooks": [
                    {
                      "debugInfo": null,
                      "hookSource": {
                        "columnNumber": 0,
                        "fileName": "**",
                        "functionName": "useInner",
                        "lineNumber": 0,
                      },
                      "id": 0,
                      "isStateEditable": true,
                      "name": "State",
                      "subHooks": [],
                      "value": 0,
                    },
                  ],
                  "value": "inner",
                },
              ],
              "value": "outer",
            },
          ]
        `);
      } else
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Outer",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useOuter",
                    "lineNumber": 0,
                  },
                  "id": null,
                  "isStateEditable": false,
                  "name": "Inner",
                  "subHooks": [
                    {
                      "debugInfo": null,
                      "hookSource": {
                        "columnNumber": 0,
                        "fileName": "**",
                        "functionName": "useInner",
                        "lineNumber": 0,
                      },
                      "id": 0,
                      "isStateEditable": true,
                      "name": "State",
                      "subHooks": [],
                      "value": 0,
                    },
                  ],
                  "value": undefined,
                },
              ],
              "value": undefined,
            },
          ]
        `);
    });
    it("should support multiple inspectable values per custom hooks", async () => {
      const useMultiLabelCustom = () => {
        React.useDebugValue("one");
        React.useDebugValue("two");
        React.useDebugValue("three");
        React.useState(0);
      };
      const useSingleLabelCustom = (value) => {
        React.useDebugValue(`single ${value}`);
        React.useState(0);
      };
      const Example = () => {
        useSingleLabelCustom("one");
        useMultiLabelCustom();
        useSingleLabelCustom("two");
        return null;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Example />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Example)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      if (__DEV__) {
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "SingleLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useSingleLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": "single one",
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "MultiLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useMultiLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 1,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": [
                "one",
                "two",
                "three",
              ],
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "SingleLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useSingleLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 2,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": "single two",
            },
          ]
        `);
      } else
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "SingleLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useSingleLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "MultiLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useMultiLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 1,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "SingleLabelCustom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useSingleLabelCustom",
                    "lineNumber": 0,
                  },
                  "id": 2,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": undefined,
            },
          ]
        `);
    });
    it("should ignore useDebugValue() made outside of a custom hook", async () => {
      const Example = () => {
        React.useDebugValue("this is invalid");
        return null;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Example />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Example)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      expect(tree).toHaveLength(0);
    });
    it("should support an optional formatter function param", async () => {
      const useCustom = () => {
        React.useDebugValue(
          {
            bar: 123,
          },
          (object) => `bar:${object.bar}`,
        );
        React.useState(0);
      };
      const Example = () => {
        useCustom();
        return null;
      };
      let renderer;
      await act(() => {
        renderer = ReactTestRenderer.create(<Example />, {
          unstable_isConcurrent: true,
        });
      });
      const childFiber = renderer.root.findByType(Example)._currentFiber();
      const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
      if (__DEV__) {
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Custom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useCustom",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": "bar:123",
            },
          ]
        `);
      } else
        expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
          [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "Example",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Custom",
              "subHooks": [
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useCustom",
                    "lineNumber": 0,
                  },
                  "id": 0,
                  "isStateEditable": true,
                  "name": "State",
                  "subHooks": [],
                  "value": 0,
                },
              ],
              "value": undefined,
            },
          ]
        `);
    });
  });
  it("should properly advance the current hook for useContext", async () => {
    const MyContext = React.createContext(1);
    let incrementCount;
    const Foo = (_props) => {
      const context = React.useContext(MyContext);
      const [data, setData] = React.useState({
        count: context,
      });
      incrementCount = () =>
        setData(({ count }) => ({
          count: count + 1,
        }));
      return <div>count: {data.count}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    expect(renderer.toJSON()).toEqual({
      type: "div",
      props: {},
      children: ["count: ", "1"],
    });
    await act(() => incrementCount());
    expect(renderer.toJSON()).toEqual({
      type: "div",
      props: {},
      children: ["count: ", "2"],
    });
    const childFiber = renderer.root._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Context",
          "subHooks": [],
          "value": 1,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": true,
          "name": "State",
          "subHooks": [],
          "value": {
            "count": 2,
          },
        },
      ]
    `);
  });
  it("should support composite useSyncExternalStore hook", async () => {
    const useSyncExternalStore = React.useSyncExternalStore;
    const Foo = () => {
      const value = useSyncExternalStore(
        () => () => {},
        () => "snapshot",
      );
      React.useMemo(() => "memo", []);
      React.useMemo(() => "not used", []);
      return value;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "SyncExternalStore",
          "subHooks": [],
          "value": "snapshot",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "memo",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should support use(Context) hook", async () => {
    const Context = React.createContext("default");
    const Foo = () => {
      const value = React.use(Context);
      React.useMemo(() => "memo", []);
      React.useMemo(() => "not used", []);
      return value;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": null,
          "isStateEditable": false,
          "name": "Context",
          "subHooks": [],
          "value": "default",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "memo",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should support useOptimistic hook", async () => {
    const useOptimistic = React.useOptimistic;
    const Foo = () => {
      const [value] = useOptimistic("abc", (currentState) => currentState);
      React.useMemo(() => "memo", []);
      React.useMemo(() => "not used", []);
      return value;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "Optimistic",
          "subHooks": [],
          "value": "abc",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "memo",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
  it("should support useActionState hook", async () => {
    const Foo = () => {
      const [value] = React.useActionState((n) => {
        return n;
      }, 0);
      React.useMemo(() => "memo", []);
      React.useMemo(() => "not used", []);
      return value;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<Foo />, {
        unstable_isConcurrent: true,
      });
    });
    const childFiber = renderer.root.findByType(Foo)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(childFiber);
    expect(normalizeSourceLoc(tree)).toMatchInlineSnapshot(`
      [
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 0,
          "isStateEditable": false,
          "name": "ActionState",
          "subHooks": [],
          "value": 0,
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 1,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "memo",
        },
        {
          "debugInfo": null,
          "hookSource": {
            "columnNumber": 0,
            "fileName": "**",
            "functionName": "Foo",
            "lineNumber": 0,
          },
          "id": 2,
          "isStateEditable": false,
          "name": "Memo",
          "subHooks": [],
          "value": "not used",
        },
      ]
    `);
  });
});
