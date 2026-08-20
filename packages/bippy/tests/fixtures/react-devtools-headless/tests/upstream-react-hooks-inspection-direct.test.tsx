// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { inspectHooks } from "bippy/source";

const ReactDebugTools = { inspectHooks };
const __DEV__ = true;

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

describe("ReactHooksInspection", () => {
  it("should inspect a simple useState hook", () => {
    const Foo = (_props) => {
      const [state] = React.useState("hello world");
      return <div>{state}</div>;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
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
          "value": "hello world",
        },
      ]
    `);
  });
  it("should inspect a simple custom hook", () => {
    const useCustom = (value) => {
      const [state] = React.useState(value);
      React.useDebugValue("custom hook label");
      return state;
    };
    const Foo = (_props) => {
      const value = useCustom("hello world");
      return <div>{value}</div>;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
    if (__DEV__) {
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
                      "value": "hello world",
                    },
                  ],
                  "value": "custom hook label",
                },
              ]
          `);
    } else {
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
                "value": "hello world",
              },
            ],
            "value": undefined,
          },
        ]
      `);
    }
  });
  it("should inspect a tree of multiple hooks", () => {
    const effect = () => {};
    const useCustom = (value) => {
      const [state] = React.useState(value);
      React.useEffect(effect);
      return state;
    };
    const Foo = (_props) => {
      const value1 = useCustom("hello");
      const value2 = useCustom("world");
      return (
        <div>
          {value1} {value2}
        </div>
      );
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
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
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useCustom",
                "lineNumber": 0,
              },
              "id": 1,
              "isStateEditable": false,
              "name": "Effect",
              "subHooks": [],
              "value": [Function],
            },
          ],
          "value": undefined,
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
              "id": 2,
              "isStateEditable": true,
              "name": "State",
              "subHooks": [],
              "value": "world",
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useCustom",
                "lineNumber": 0,
              },
              "id": 3,
              "isStateEditable": false,
              "name": "Effect",
              "subHooks": [],
              "value": [Function],
            },
          ],
          "value": undefined,
        },
      ]
    `);
  });
  it("should inspect a tree of multiple levels of hooks", () => {
    const effect = () => {};
    const useCustom = (value) => {
      const [state] = React.useReducer((s, _action) => s, value);
      React.useEffect(effect);
      return state;
    };
    const useBar = (value) => {
      const result = useCustom(value);
      React.useLayoutEffect(effect);
      return result;
    };
    const useBaz = (value) => {
      React.useLayoutEffect(effect);
      const result = useCustom(value);
      return result;
    };
    const Foo = (_props) => {
      const value1 = useBar("hello");
      const value2 = useBaz("world");
      return (
        <div>
          {value1} {value2}
        </div>
      );
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
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
          "name": "Bar",
          "subHooks": [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useBar",
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
                  "name": "Reducer",
                  "subHooks": [],
                  "value": "hello",
                },
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useCustom",
                    "lineNumber": 0,
                  },
                  "id": 1,
                  "isStateEditable": false,
                  "name": "Effect",
                  "subHooks": [],
                  "value": [Function],
                },
              ],
              "value": undefined,
            },
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useBar",
                "lineNumber": 0,
              },
              "id": 2,
              "isStateEditable": false,
              "name": "LayoutEffect",
              "subHooks": [],
              "value": [Function],
            },
          ],
          "value": undefined,
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
          "name": "Baz",
          "subHooks": [
            {
              "debugInfo": null,
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useBaz",
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
                "functionName": "useBaz",
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
                  "id": 4,
                  "isStateEditable": true,
                  "name": "Reducer",
                  "subHooks": [],
                  "value": "world",
                },
                {
                  "debugInfo": null,
                  "hookSource": {
                    "columnNumber": 0,
                    "fileName": "**",
                    "functionName": "useCustom",
                    "lineNumber": 0,
                  },
                  "id": 5,
                  "isStateEditable": false,
                  "name": "Effect",
                  "subHooks": [],
                  "value": [Function],
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
  it("should not confuse built-in hooks with custom hooks that have the same name", () => {
    const useState = (value) => {
      React.useState(value);
      React.useDebugValue("custom useState");
    };
    const useFormStatus = () => {
      React.useState("custom useState");
      React.useDebugValue("custom useFormStatus");
    };
    const Foo = (_props) => {
      useFormStatus();
      useState("Hello, Dave!");
      return null;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
    if (__DEV__) {
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
            "name": "FormStatus",
            "subHooks": [
              {
                "debugInfo": null,
                "hookSource": {
                  "columnNumber": 0,
                  "fileName": "**",
                  "functionName": "useFormStatus",
                  "lineNumber": 0,
                },
                "id": 0,
                "isStateEditable": true,
                "name": "State",
                "subHooks": [],
                "value": "custom useState",
              },
            ],
            "value": "custom useFormStatus",
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
            "name": "State",
            "subHooks": [
              {
                "debugInfo": null,
                "hookSource": {
                  "columnNumber": 0,
                  "fileName": "**",
                  "functionName": "useState",
                  "lineNumber": 0,
                },
                "id": 1,
                "isStateEditable": true,
                "name": "State",
                "subHooks": [],
                "value": "Hello, Dave!",
              },
            ],
            "value": "custom useState",
          },
        ]
      `);
    } else {
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
            "name": "FormStatus",
            "subHooks": [
              {
                "debugInfo": null,
                "hookSource": {
                  "columnNumber": 0,
                  "fileName": "**",
                  "functionName": "useFormStatus",
                  "lineNumber": 0,
                },
                "id": 0,
                "isStateEditable": true,
                "name": "State",
                "subHooks": [],
                "value": "custom useState",
              },
            ],
            "value": undefined,
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
            "name": "State",
            "subHooks": [
              {
                "debugInfo": null,
                "hookSource": {
                  "columnNumber": 0,
                  "fileName": "**",
                  "functionName": "useState",
                  "lineNumber": 0,
                },
                "id": 1,
                "isStateEditable": true,
                "name": "State",
                "subHooks": [],
                "value": "Hello, Dave!",
              },
            ],
            "value": undefined,
          },
        ]
      `);
    }
  });
  it("should inspect the default value using the useContext hook", () => {
    const MyContext = React.createContext("default");
    const Foo = (_props) => {
      const value = React.useContext(MyContext);
      return <div>{value}</div>;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
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
      ]
    `);
  });
  it("should inspect use() calls for Promise and Context", async () => {
    const MyContext = React.createContext("hi");
    const promise = Promise.resolve("world");
    await promise;
    promise.status = "fulfilled";
    promise.value = "world";
    promise._debugInfo = [
      {
        name: "Hello",
      },
    ];
    const useCustom = () => {
      const value = React.use(promise);
      const [state] = React.useState(value);
      return state;
    };
    const Foo = (_props) => {
      const value1 = React.use(MyContext);
      const value2 = useCustom();
      return (
        <div>
          {value1} {value2}
        </div>
      );
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
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
          "value": "hi",
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
          "name": "Custom",
          "subHooks": [
            {
              "debugInfo": [
                {
                  "name": "Hello",
                },
              ],
              "hookSource": {
                "columnNumber": 0,
                "fileName": "**",
                "functionName": "useCustom",
                "lineNumber": 0,
              },
              "id": null,
              "isStateEditable": false,
              "name": "Use",
              "subHooks": [],
              "value": "world",
            },
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
              "value": "world",
            },
          ],
          "value": undefined,
        },
      ]
    `);
  });
  it("should inspect use() calls for unresolved Promise", () => {
    const promise = Promise.resolve("hi");
    const Foo = (_props) => {
      const value = React.use(promise);
      return <div>{value}</div>;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {});
    const results = normalizeSourceLoc(tree);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchInlineSnapshot(
      {
        value: expect.any(Promise),
      },
      `
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
        "name": "Use",
        "subHooks": [],
        "value": Any<Promise>,
      }
    `,
    );
  });
  it("should inspect use() calls in anonymous loops", () => {
    const Foo = ({ entries }) => {
      const values = Object.fromEntries(
        Object.entries(entries).map(([key, value]) => {
          return [key, React.use(value)];
        }),
      );
      return <div>{values}</div>;
    };
    const tree = ReactDebugTools.inspectHooks(Foo, {
      entries: {
        one: Promise.resolve("one"),
        two: Promise.resolve("two"),
      },
    });
    const results = normalizeSourceLoc(tree);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchInlineSnapshot(
      {
        subHooks: [
          {
            value: expect.any(Promise),
          },
        ],
      },
      `
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
        "name": "",
        "subHooks": [
          {
            "debugInfo": null,
            "hookSource": {
              "columnNumber": 0,
              "fileName": "**",
              "functionName": null,
              "lineNumber": 0,
            },
            "id": null,
            "isStateEditable": false,
            "name": "Use",
            "subHooks": [],
            "value": Any<Promise>,
          },
        ],
        "value": undefined,
      }
    `,
    );
  });
  describe("useDebugValue", () => {
    it("should be ignored when called outside of a custom hook", () => {
      const Foo = (_props) => {
        React.useDebugValue("this is invalid");
        return null;
      };
      const tree = ReactDebugTools.inspectHooks(Foo, {});
      expect(tree).toHaveLength(0);
    });
    it("should support an optional formatter function param", () => {
      const useCustom = () => {
        React.useDebugValue(
          {
            bar: 123,
          },
          (object) => `bar:${object.bar}`,
        );
        React.useState(0);
      };
      const Foo = (_props) => {
        useCustom();
        return null;
      };
      const tree = ReactDebugTools.inspectHooks(Foo, {});
      if (__DEV__) {
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
                          "value": 0,
                        },
                      ],
                      "value": "bar:123",
                    },
                  ]
              `);
      } else {
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
                  "value": 0,
                },
              ],
              "value": undefined,
            },
          ]
        `);
      }
    });
  });
});
