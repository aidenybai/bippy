import { expect, it } from "vite-plus/test";
import {
  branchValue,
  listValue,
  objectFromRecord,
  primitiveValue,
} from "../src/evaluate/values.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { replayStateSpace } from "../src/harness/state-replay.js";
import type {
  StaticElementType,
  StaticElementValue,
  StaticValue,
  StubComponent,
} from "../src/types.js";
import { createComponentRenderer } from "./helpers/component-runner.js";

const element = (type: StaticElementType, children: StaticValue[] = []): StaticElementValue => ({
  kind: "element",
  type,
  key: null,
  props: objectFromRecord({ children: listValue(children) }),
  location: null,
  environment: null,
  owner: null,
});

const getStubTree = (): StaticValue => {
  let setReady: (value: StaticValue) => void = () => {
    throw new Error("root has not rendered");
  };
  const trigger: StubComponent = {
    displayName: "Trigger",
    render: (_, tools) => {
      tools.hooks?.useEffect(() => setReady(primitiveValue(true)), []);
      return element({ kind: "host", tagName: "canvas" });
    },
  };
  const root: StubComponent = {
    displayName: "Root",
    render: (_, tools) => {
      if (!tools.hooks) throw new Error("missing client hooks");
      const [isReady, updateReady] = tools.hooks.useState(primitiveValue(false));
      setReady = updateReady;
      return element({ kind: "host", tagName: "main" }, [
        branchValue(
          [element({ kind: "stub", stub: trigger }), element({ kind: "host", tagName: "aside" })],
          "environment-dependent trigger",
        ),
        element({
          kind: "host",
          tagName: isReady.kind === "primitive" && isReady.value ? "strong" : "span",
        }),
      ]);
    },
  };
  return element({ kind: "stub", stub: root });
};

it("preserves causes through modeled library hooks", async () => {
  const renderer = await createComponentRenderer();
  const space = enumerateStaticStates(await renderer.renderWith(getStubTree));
  expect(space.commitStates.map((commit) => commit.stateCount)).toEqual([2, 1]);
  const replay = await replayStateSpace(
    space,
    (decisions) => renderer.derive({ decisions }).renderWith(getStubTree),
    null,
  );
  expect(replay.summary.mismatched).toEqual([]);
});
