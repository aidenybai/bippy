import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface ChainOptions {
  target: "object" | "symbol";
  reverse: boolean;
  split: boolean;
}

const getChainSetup = ({ target, reverse, split }: ChainOptions): string => `
  var root, collections, references, membership;
  (() => {
    const keys = Array.from({ length: 6 }, () => ${target === "object" ? "({})" : "Symbol('key')"});
    root = keys[0];
    references = keys.slice(1).map((key) => new WeakRef(key));
    membership = new WeakSet([keys[5]]);
    const entries = keys.slice(0, -1).map((key, index) => [key, keys[index + 1]]);
    ${reverse ? "entries.reverse();" : ""}
    collections = ${split ? "entries.map(entry => new WeakMap([entry]))" : "[new WeakMap(entries)]"};
  })();
`;

const observation = `JSON.stringify([
    references.map((reference) => reference.deref() !== undefined),
    membership.has(references[references.length - 1].deref()),
  ])`;

const targets: ChainOptions["target"][] = ["object", "symbol"];
const chains = targets.flatMap((target) =>
  [false, true].flatMap((reverse) => [false, true].map((split) => ({ target, reverse, split }))),
);

it.each(chains)(
  "retains a $target chain with reverse=$reverse and split=$split",
  async (options) => {
    const setup = getChainSetup(options);
    const expected = getNativeGcObservation(setup, observation);
    expect(expected).toBe("[[true,true,true,true,true],true]");
    await withFixture(({ api, evaluate, readString }) => {
      evaluate(setup);
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString(observation)).toBe(expected);
      evaluate("root = undefined");
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString(observation)).toBe("[[false,false,false,false,false],false]");
    });
  },
);

it.each([false, true])("marks newly discovered WeakMaps with reverse=%s", async (reverse) => {
  const setup = `
    var root = {},
      collection,
      reference;
    (() => {
      const middle = {},
        target = {},
        nested = new WeakMap();
      reference = new WeakRef(target);
      nested.set(middle, target);
      collection = new WeakMap(${reverse ? "[[middle, nested], [root, middle]]" : "[[root, middle], [middle, nested]]"});
    })();
  `;
  const result = "String(reference.deref() !== undefined)";
  const expected = getNativeGcObservation(setup, result);
  expect(expected).toBe("true");
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(result)).toBe(expected);
  });
});

it.each([false, true])("handles a weak cycle with a strong root=%s", async (isRooted) => {
  const setup = `
    var root, collection, references;
    (() => {
      const first = {},
        second = {};
      ${isRooted ? "root = first;" : ""}
      collection = new WeakMap([
        [second, first],
        [first, second],
      ]);
      references = [new WeakRef(first), new WeakRef(second)];
    })();
  `;
  const result = "JSON.stringify(references.map(reference => reference.deref() !== undefined))";
  const expected = getNativeGcObservation(setup, result);
  expect(expected).toBe(isRooted ? "[true,true]" : "[false,false]");
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(result)).toBe(expected);
  });
});

it("does not finalize a value reached through a reversed ephemeron chain", async () => {
  await withFixture(({ api, evaluate }) => {
    evaluate(`
      ${getChainSetup({ target: "object", reverse: true, split: true })}
      var registry = new FinalizationRegistry(() => {});
      registry.register(references[4].deref(), "held");
    `);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(api.surroundingAgent.finalizationRegistryScheduledForCleanup.size).toBe(0);
  });
});

it("does not mark values behind a deleted key", async () => {
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(`
      ${getChainSetup({ target: "object", reverse: true, split: true })}
      collections[4].delete(root);
    `);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(observation)).toBe("[[false,false,false,false,false],false]");
  });
});
