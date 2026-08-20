import "../src/index.js";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTools, installFacade } from "../src/index.js";
import type { Facade, Tools, TreeNode } from "../src/index.js";

interface EditableProps {
  array?: unknown[];
  object?: Record<string, unknown>;
  shallow?: unknown;
}

interface EditableState {
  array: unknown[];
  object: Record<string, unknown>;
  shallow?: unknown;
}

const Context = React.createContext<EditableState>({
  array: [1, 2, 3],
  object: { nested: "initial" },
  shallow: "initial",
});

let facade: Facade;
let tools: Tools;

const getTree = (): TreeNode[] => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw tree.error;
  return tree;
};

const getUid = (name: string): string => {
  const node = getTree().find((treeNode) => treeNode.name === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node.uid;
};

const getInitialValue = (): EditableState => ({
  array: [1, 2, 3],
  object: { nested: "initial" },
  shallow: "initial",
});

const EditableFunction = (props: EditableProps) => <output>{JSON.stringify(props)}</output>;

class EditableClass extends React.Component<object, EditableState> {
  state = getInitialValue();

  render() {
    return <output>{JSON.stringify(this.state)}</output>;
  }
}

class EditableContext extends React.Component {
  static contextType = Context;
  declare context: React.ContextType<typeof Context>;

  render() {
    return <output>{JSON.stringify(this.context)}</output>;
  }
}

const EditableHook = () => {
  const [state] = React.useState(getInitialValue());
  return <output>{JSON.stringify(state)}</output>;
};

const expectOutput = async (text: string): Promise<void> => {
  await waitFor(() => expect(document.body.textContent).toContain(text));
};

const performAction = async (action: () => unknown, expectedText: string): Promise<void> => {
  act(action);
  await expectOutput(expectedText);
};

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream modern editing behavior", () => {
  describe("props", () => {
    it("should have editable values", async () => {
      render(<EditableFunction {...getInitialValue()} />);
      const uid = getUid("EditableFunction");
      await performAction(
        () => tools.overrideProps(uid, ["shallow"], "updated"),
        '"shallow":"updated"',
      );
      await performAction(
        () => tools.overrideProps(uid, ["object", "nested"], "updated"),
        '"nested":"updated"',
      );
      await performAction(
        () => tools.overrideProps(uid, ["array", 1], "updated"),
        '"array":[1,"updated",3]',
      );
    });

    it("should still support overriding prop values with legacy backend methods", async () => {
      render(<EditableFunction shallow="initial" />);
      act(() => {
        tools.overrideProps(getUid("EditableFunction"), ["shallow"], "legacy");
      });
      await expectOutput('"shallow":"legacy"');
    });

    it("should have editable paths", async () => {
      render(<EditableFunction {...getInitialValue()} />);
      const uid = getUid("EditableFunction");
      await performAction(
        () => tools.renameProps(uid, ["shallow"], ["renamed"]),
        '"renamed":"initial"',
      );
      await performAction(
        () => tools.renameProps(uid, ["object", "nested"], ["object", "renamed"]),
        '"object":{"renamed":"initial"}',
      );
      expect(document.body.textContent).not.toContain('"shallow"');
      expect(document.body.textContent).not.toContain('"nested"');
    });

    it("should enable adding new object properties and array values", async () => {
      render(<EditableFunction {...getInitialValue()} />);
      const uid = getUid("EditableFunction");
      await performAction(() => tools.overrideProps(uid, ["new"], "value"), '"new":"value"');
      await performAction(
        () => tools.overrideProps(uid, ["object", "new"], "value"),
        '"object":{"nested":"initial","new":"value"}',
      );
      await performAction(
        () => tools.overrideProps(uid, ["array", 3], "value"),
        '"array":[1,2,3,"value"]',
      );
    });

    it("should have deletable keys", async () => {
      render(<EditableFunction {...getInitialValue()} />);
      const uid = getUid("EditableFunction");
      act(() => tools.deleteProps(uid, ["shallow"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("shallow"));
      act(() => tools.deleteProps(uid, ["object", "nested"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("nested"));
      await performAction(() => tools.deleteProps(uid, ["array", 1]), '"array":[1,3]');
      expect(document.body.textContent).not.toContain("shallow");
      expect(document.body.textContent).not.toContain("nested");
    });

    it("should support editing host component values", async () => {
      const view = render(<input data-before="value" />);
      act(() => {
        tools.renameProps(getUid("input"), ["data-before"], ["data-after"]);
      });
      await waitFor(() =>
        expect(view.container.querySelector("input")?.dataset.after).toBe("value"),
      );
    });
  });

  describe("state", () => {
    it("should have editable values", async () => {
      render(<EditableClass />);
      const uid = getUid("EditableClass");
      await performAction(
        () => tools.overrideState(uid, ["shallow"], "updated"),
        '"shallow":"updated"',
      );
      await performAction(
        () => tools.overrideState(uid, ["object", "nested"], "updated"),
        '"nested":"updated"',
      );
      await performAction(
        () => tools.overrideState(uid, ["array", 1], "updated"),
        '"array":[1,"updated",3]',
      );
    });

    it("should still support overriding state values with legacy backend methods", async () => {
      render(<EditableClass />);
      act(() => {
        tools.overrideState(getUid("EditableClass"), ["shallow"], "legacy");
      });
      await expectOutput('"shallow":"legacy"');
    });

    it("should have editable paths", async () => {
      render(<EditableClass />);
      const uid = getUid("EditableClass");
      await performAction(
        () => tools.renameState(uid, ["shallow"], ["renamed"]),
        '"renamed":"initial"',
      );
      await performAction(
        () => tools.renameState(uid, ["object", "nested"], ["object", "renamed"]),
        '"object":{"renamed":"initial"}',
      );
    });

    it("should enable adding new object properties and array values", async () => {
      render(<EditableClass />);
      const uid = getUid("EditableClass");
      await performAction(() => tools.overrideState(uid, ["new"], "value"), '"new":"value"');
      await performAction(
        () => tools.overrideState(uid, ["object", "new"], "value"),
        '"object":{"nested":"initial","new":"value"}',
      );
      await performAction(
        () => tools.overrideState(uid, ["array", 3], "value"),
        '"array":[1,2,3,"value"]',
      );
    });

    it("should have deletable keys", async () => {
      render(<EditableClass />);
      const uid = getUid("EditableClass");
      act(() => tools.deleteState(uid, ["shallow"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("shallow"));
      act(() => tools.deleteState(uid, ["object", "nested"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("nested"));
      await performAction(() => tools.deleteState(uid, ["array", 1]), '"array":[1,3]');
    });
  });

  describe("hooks", () => {
    it("should have editable values", async () => {
      render(<EditableHook />);
      const uid = getUid("EditableHook");
      await performAction(
        () => tools.overrideHookState(uid, 0, ["shallow"], "updated"),
        '"shallow":"updated"',
      );
      await performAction(
        () => tools.overrideHookState(uid, 0, ["object", "nested"], "updated"),
        '"nested":"updated"',
      );
      await performAction(
        () => tools.overrideHookState(uid, 0, ["array", 1], "updated"),
        '"array":[1,"updated",3]',
      );
    });

    it("should still support overriding hook values with legacy backend methods", async () => {
      render(<EditableHook />);
      act(() => {
        tools.overrideHookState(getUid("EditableHook"), 0, ["shallow"], "legacy");
      });
      await expectOutput('"shallow":"legacy"');
    });

    it("should have editable paths", async () => {
      render(<EditableHook />);
      const uid = getUid("EditableHook");
      await performAction(
        () => tools.renameHookState(uid, 0, ["shallow"], ["renamed"]),
        '"renamed":"initial"',
      );
      await performAction(
        () => tools.renameHookState(uid, 0, ["object", "nested"], ["object", "renamed"]),
        '"object":{"renamed":"initial"}',
      );
    });

    it("should enable adding new object properties and array values", async () => {
      render(<EditableHook />);
      const uid = getUid("EditableHook");
      await performAction(() => tools.overrideHookState(uid, 0, ["new"], "value"), '"new":"value"');
      await performAction(
        () => tools.overrideHookState(uid, 0, ["object", "new"], "value"),
        '"object":{"nested":"initial","new":"value"}',
      );
      await performAction(
        () => tools.overrideHookState(uid, 0, ["array", 3], "value"),
        '"array":[1,2,3,"value"]',
      );
    });

    it("should have deletable keys", async () => {
      render(<EditableHook />);
      const uid = getUid("EditableHook");
      act(() => tools.deleteHookState(uid, 0, ["shallow"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("shallow"));
      act(() => tools.deleteHookState(uid, 0, ["object", "nested"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("nested"));
      await performAction(() => tools.deleteHookState(uid, 0, ["array", 1]), '"array":[1,3]');
    });
  });

  describe("context", () => {
    it("should have editable values", async () => {
      render(
        <Context.Provider value={getInitialValue()}>
          <EditableContext />
        </Context.Provider>,
      );
      const uid = getUid("EditableContext");
      await performAction(
        () => tools.overrideContext(uid, ["shallow"], "updated"),
        '"shallow":"updated"',
      );
      await performAction(
        () => tools.overrideContext(uid, ["object", "nested"], "updated"),
        '"nested":"updated"',
      );
      await performAction(
        () => tools.overrideContext(uid, ["array", 1], "updated"),
        '"array":[1,"updated",3]',
      );
    });

    it("should still support overriding context values with legacy backend methods", async () => {
      render(
        <Context.Provider value={getInitialValue()}>
          <EditableContext />
        </Context.Provider>,
      );
      act(() => {
        tools.overrideContext(getUid("EditableContext"), ["shallow"], "legacy");
      });
      await expectOutput('"shallow":"legacy"');
    });

    it("should have editable paths", async () => {
      render(
        <Context.Provider value={getInitialValue()}>
          <EditableContext />
        </Context.Provider>,
      );
      const uid = getUid("EditableContext");
      await performAction(
        () => tools.renameContext(uid, ["shallow"], ["renamed"]),
        '"renamed":"initial"',
      );
      await performAction(
        () => tools.renameContext(uid, ["object", "nested"], ["object", "renamed"]),
        '"object":{"renamed":"initial"}',
      );
    });

    it("should enable adding new object properties and array values", async () => {
      render(
        <Context.Provider value={getInitialValue()}>
          <EditableContext />
        </Context.Provider>,
      );
      const uid = getUid("EditableContext");
      await performAction(() => tools.overrideContext(uid, ["new"], "value"), '"new":"value"');
      await performAction(
        () => tools.overrideContext(uid, ["object", "new"], "value"),
        '"object":{"nested":"initial","new":"value"}',
      );
      await performAction(
        () => tools.overrideContext(uid, ["array", 3], "value"),
        '"array":[1,2,3,"value"]',
      );
    });

    it("should have deletable keys", async () => {
      render(
        <Context.Provider value={getInitialValue()}>
          <EditableContext />
        </Context.Provider>,
      );
      const uid = getUid("EditableContext");
      act(() => tools.deleteContext(uid, ["shallow"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("shallow"));
      act(() => tools.deleteContext(uid, ["object", "nested"]));
      await waitFor(() => expect(document.body.textContent).not.toContain("nested"));
      await performAction(() => tools.deleteContext(uid, ["array", 1]), '"array":[1,3]');
    });
  });
});
