// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { getFiberHooks, inspectHooks } from "bippy/source";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const act = React.act;
const ReactDebugTools = { inspectHooks, inspectHooksOfFiber: getFiberHooks };

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
  it("should support useFormStatus hook", async () => {
    const FormStatus = () => {
      const status = ReactDOM.useFormStatus();
      React.useMemo(() => "memo", []);
      React.useMemo(() => "not used", []);
      return JSON.stringify(status);
    };
    const treeWithoutFiber = ReactDebugTools.inspectHooks(FormStatus);
    expect(normalizeSourceLoc(treeWithoutFiber)).toEqual([
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: null,
        isStateEditable: false,
        name: "FormStatus",
        subHooks: [],
        value: null,
      },
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: 0,
        isStateEditable: false,
        name: "Memo",
        subHooks: [],
        value: "memo",
      },
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: 1,
        isStateEditable: false,
        name: "Memo",
        subHooks: [],
        value: "not used",
      },
    ]);
    const root = ReactDOMClient.createRoot(document.createElement("div"));
    await act(() => {
      root.render(
        <form>
          <FormStatus />
        </form>,
      );
    });
    const formStatusFiber = root._internalRoot.current.child.child;
    const treeWithFiber = ReactDebugTools.inspectHooksOfFiber(formStatusFiber);
    expect(normalizeSourceLoc(treeWithFiber)).toEqual([
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: null,
        isStateEditable: false,
        name: "FormStatus",
        subHooks: [],
        value: {
          action: null,
          data: null,
          method: null,
          pending: false,
        },
      },
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: 0,
        isStateEditable: false,
        name: "Memo",
        subHooks: [],
        value: "memo",
      },
      {
        debugInfo: null,
        hookSource: {
          columnNumber: 0,
          fileName: "**",
          functionName: "FormStatus",
          lineNumber: 0,
        },
        id: 1,
        isStateEditable: false,
        name: "Memo",
        subHooks: [],
        value: "not used",
      },
    ]);
  });
});
