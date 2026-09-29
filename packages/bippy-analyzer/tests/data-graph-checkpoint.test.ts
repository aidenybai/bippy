import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const setup = `var root=Object.create(null),child=Object.create(null),prototype=Object.create(null);child.value=1;prototype.inherited=10;Object.setPrototypeOf(child,prototype);child.parent=root;root.child=child;root.alias=child;root.array=[child];Object.setPrototypeOf(root.array,null);root.map=new Map([[child,prototype]]);Object.setPrototypeOf(root.map,null);root.set=new Set([child]);Object.setPrototypeOf(root.set,null);`;
const observation = `JSON.stringify([root.child===root.alias,child.parent===root,root.array[0]===child,child.value,child.inherited,root.array.length,Map.prototype.get.call(root.map,child)===prototype,Set.prototype.has.call(root.set,child),Object.isExtensible(child),Object.getPrototypeOf(child)===prototype])`;
it.each([false, true])(
  "restores a closed graph with cycles, aliases and collections, reversed=%s",
  async (isReversed) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(setup);
      const root = getObject("root");
      const roots = [root];
      const checkpoint = api.createDataGraphCheckpoint({ roots });
      roots.length = 0;
      expect(checkpoint.scope).toBe("closed-data-graph-v1");
      expect(checkpoint.objectCount).toBe(6);
      const baseline = readString(observation);
      expect(baseline).toBe(runInNewContext(setup + observation));
      const actions = [
        "root.alias.value=7;prototype.inherited=20;Array.prototype.push.call(root.array,null);Map.prototype.clear.call(root.map);Set.prototype.clear.call(root.set);Object.freeze(child);",
        "root.alias=Object.create(null);root.array[0]=null;child.value=-5;Object.setPrototypeOf(child,null);Map.prototype.set.call(root.map,child,root);Object.preventExtensions(child);",
      ];
      try {
        for (const action of isReversed ? [...actions].reverse() : actions) {
          evaluate(action);
          expect(readString(observation)).toBe(runInNewContext(setup + action + observation));
          checkpoint.restore();
          expect(readString(observation)).toBe(baseline);
        }
      } finally {
        checkpoint.release();
      }
    });
  },
);

it.each([false, true])(
  "forks Agent-owned decisions over a closed data graph without replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, compile, evaluate, createBoolean }) => {
      const initial =
        "var graph=Object.create(null);graph.child=Object.create(null);graph.child.value=1;graph.alias=graph.child;";
      evaluate(initial);
      const root = realm.GlobalObject.properties.get(api.Value("graph"))?.Value;
      if (!(root instanceof api.ObjectValue)) throw Error("Expected graph");
      createBoolean("enabled");
      let prefixes = 0;
      const results: number[] = [];
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const source =
        "void 1;if(enabled)graph.child.value+=3;else graph.alias.value-=2;graph.child.value+graph.alias.value;";
      agent.evaluate(
        compile(source),
        (completion) => {
          if (!(completion.Value instanceof api.NumberValue)) throw Error("Expected Number");
          results.push(completion.Value.numberValue());
        },
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      const state = api.createDataGraphCheckpoint({ roots: [root] });
      const control = agent.captureEvaluation({
        capture: () => ({
          restore: () => {
            state.restore();
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        }),
      });
      try {
        for (const choice of isReversed ? [true, false] : [false, true]) {
          control.restore();
          agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: choice,
            },
          });
          expect(results.at(-1)).toBe(
            runInNewContext(initial + source, {
              enabled: choice,
            }),
          );
        }
      } finally {
        control.release();
        state.release();
      }
      expect(prefixes).toBe(1);
      expect(results).toHaveLength(2);
    });
  },
);

it.each([
  "{}",
  "()=>1",
  "new WeakMap()",
  "new Proxy(Object.create(null),{})",
  "new Uint8Array(1)",
  "Promise.resolve(1)",
])("rejects unsupported reachable state: %s", async (expression) => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate(`var root=Object.create(null);root.child=(${expression});`);
    const root = getObject("root");
    expect(() => api.createDataGraphCheckpoint({ roots: [root] })).toThrow(
      /Checkpoint requires|Data graph cannot/,
    );
    const checkpoint = api.createStateCheckpoint({ objects: [root] });
    checkpoint.restore();
    checkpoint.release();
  });
});

it("rejects accessor functions without executing guest getters", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      'var reads=0,root=Object.create(null);Object.defineProperty(root,"value",{get(){reads++;return 1}});',
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [getObject("root")] })).toThrow(
      "Data graph cannot own function state",
    );
    expect(readString("String(reads)")).toBe("0");
  });
});

it("follows symbol-keyed data properties and rejects a hidden unsupported child", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate(
      'var root=Object.create(null);Object.defineProperty(root,Symbol("key"),{value:new WeakMap()});',
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [getObject("root")] })).toThrow(
      "Checkpoint requires",
    );
  });
});

it("counts prototypes, roots, descriptors and collection tombstones against entry bounds", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate("var root=Object.create(null);root.value=1;");
    const root = getObject("root");
    expect(() => api.createDataGraphCheckpoint({ roots: [root], maxEntries: 2 })).toThrow(
      "entry budget",
    );
    const exact = api.createDataGraphCheckpoint({ roots: [root], maxObjects: 1, maxEntries: 3 });
    expect(exact.entryCount).toBe(3);
    exact.release();
    evaluate("root.child=Object.create(null)");
    expect(() => api.createDataGraphCheckpoint({ roots: [root], maxObjects: 1 })).toThrow(
      "object budget",
    );
    evaluate("var map=new Map([[1,2],[3,4]]);map.clear();Object.setPrototypeOf(map,null);");
    expect(() =>
      api.createDataGraphCheckpoint({ roots: [getObject("map")], maxEntries: 3 }),
    ).toThrow("entry budget");
    const tombstones = api.createDataGraphCheckpoint({ roots: [getObject("map")], maxEntries: 4 });
    expect(tombstones.entryCount).toBe(4);
    tombstones.release();
  });
});

it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid limits: %s", async (limit) => {
  await withFixture(({ api }) => {
    expect(() => api.createDataGraphCheckpoint({ roots: [], maxObjects: limit })).toThrow(
      "positive safe integers",
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [], maxEntries: limit })).toThrow(
      "positive safe integers",
    );
  });
});

it("ignores custom root iteration and retains shared LIFO release semantics", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate("var root=Object.create(null)");
    const root = getObject("root");
    const roots = [root];
    Object.defineProperty(roots, Symbol.iterator, {
      value: () => {
        throw Error("root iterator");
      },
    });
    const outer = api.createDataGraphCheckpoint({ roots });
    const inner = api.createStateCheckpoint({ objects: [root] });
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.release();
    outer.restore();
    outer.release();
    expect(() => outer.restore()).toThrow("released");
    expect(() => outer.release()).toThrow("released");
  });
});

it("follows collection-only keys, values, members and symbol-keyed children", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      'var key=Object.create(null),value=Object.create(null),member=Object.create(null),symbolChild=Object.create(null);key.count=1;value.count=2;member.count=3;symbolChild.count=4;var root=new Map([[key,value]]);Object.setPrototypeOf(root,null);root.members=new Set([member]);Object.setPrototypeOf(root.members,null);root[Symbol("child")]=symbolChild;',
    );
    const checkpoint = api.createDataGraphCheckpoint({ roots: [getObject("root")] });
    expect(checkpoint.objectCount).toBe(6);
    evaluate("key.count=10;value.count=20;member.count=30;symbolChild.count=40;");
    checkpoint.restore();
    expect(
      readString("JSON.stringify([key.count,value.count,member.count,symbolChild.count])"),
    ).toBe("[1,2,3,4]");
    checkpoint.release();
  });
});

it("does not leave a registered frame after unsupported-state or budget rejection", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate("var root=Object.create(null);root.child=new WeakMap();");
    const root = getObject("root");
    const outer = api.createStateCheckpoint({ objects: [root] });
    expect(() => api.createDataGraphCheckpoint({ roots: [root] })).toThrow("Checkpoint requires");
    outer.restore();
    expect(() => api.createDataGraphCheckpoint({ roots: [root], maxEntries: 1 })).toThrow(
      "entry budget",
    );
    outer.restore();
    outer.release();
  });
});

it("rejects reachable objects from another Agent", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate("var root=Object.create(null)");
    const root = getObject("root");
    const owner = api.surroundingAgent;
    const other = new api.Agent({ startEventLoop: false });
    api.setSurroundingAgent(other);
    let child;
    try {
      child = api.OrdinaryObjectCreate(api.Value.null);
    } finally {
      api.setSurroundingAgent(owner);
    }
    api.X(api.CreateDataPropertyOrThrow(root, "child", child));
    expect(() => api.createDataGraphCheckpoint({ roots: [root] })).toThrow(
      "belong to the current agent",
    );
  });
});

it("roots removed descendants until release", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      "var root=Object.create(null),reference;(()=>{const held=Object.create(null);root.child=held;reference=new WeakRef(held)})();",
    );
    const checkpoint = api.createDataGraphCheckpoint({ roots: [getObject("root")] });
    evaluate("delete root.child");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("true");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()===undefined)")).toBe("true");
  });
});
