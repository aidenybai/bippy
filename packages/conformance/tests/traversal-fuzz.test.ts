import { traverseFiber, type Fiber } from "bippy";
import { describe, expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface ModelNode {
  fiber: Fiber;
  parent: ModelNode | null;
  children: ModelNode[];
}

const getPreorder = (node: ModelNode): Fiber[] => [
  node.fiber,
  ...node.children.flatMap(getPreorder),
];

const getAncestry = (node: ModelNode): Fiber[] =>
  node.parent ? [node.fiber, ...getAncestry(node.parent)] : [node.fiber];

const createTree = (getRandom: (limit: number) => number): ModelNode[] => {
  const nodes: ModelNode[] = [{ fiber: createFiber({ key: "0" }), parent: null, children: [] }];
  for (let index = 1; index < 100; index++) {
    const parent = nodes[getRandom(nodes.length)];
    const node: ModelNode = { fiber: createFiber({ key: String(index) }), parent, children: [] };
    parent.children.push(node);
    nodes.push(node);
  }
  for (const node of nodes)
    linkChildren(
      node.fiber,
      node.children.map((child) => child.fiber),
    );
  nodes[0].fiber.sibling = createFiber({ key: "outside-subtree" });
  return nodes;
};

const expectIdenticalOrder = (actual: Fiber[], expected: Fiber[], context: string): void => {
  expect(
    actual.map((fiber) => fiber.key),
    context,
  ).toEqual(expected.map((fiber) => fiber.key));
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index] === expected[index], context).toBe(true);
  }
};

describe.each(fuzzSeeds)("traversal model seed %i", (seed) => {
  it("matches an independent tree model across subtree boundaries, directions and async handoffs", async () => {
    const getRandom = createSeededRandom(seed);
    for (let iteration = 0; iteration < 16; iteration++) {
      const nodes = createTree(getRandom);
      const links = nodes.map(({ fiber }) => [fiber.child, fiber.sibling, fiber.return]);
      for (const start of [nodes[0], nodes[1], nodes[getRandom(nodes.length)]]) {
        for (const ascending of [false, true]) {
          const expected = ascending ? getAncestry(start) : getPreorder(start);
          for (const stopIndex of [-1, 0, getRandom(expected.length), expected.length - 1]) {
            const target = expected[stopIndex] ?? null;
            const prefix = stopIndex < 0 ? expected : expected.slice(0, stopIndex + 1);
            for (const mode of ["sync", "async", "mixed"]) {
              const context = JSON.stringify({
                seed,
                iteration,
                start: start.fiber.key,
                ascending,
                stopIndex,
                mode,
              });
              const visited: Fiber[] = [];
              const result = traverseFiber(
                start.fiber,
                (fiber) => {
                  visited.push(fiber);
                  const selection =
                    fiber === target ? true : visited.length % 2 === 0 ? false : undefined;
                  return mode === "async" || (mode === "mixed" && getRandom(3) === 0)
                    ? Promise.resolve(selection)
                    : selection;
                },
                ascending,
              );
              if (mode === "sync") expect(result instanceof Promise, context).toBe(false);
              expect((await result) === target, context).toBe(true);
              expectIdenticalOrder(visited, prefix, context);
            }
          }
        }
      }
      for (let index = 0; index < nodes.length; index++) {
        const { fiber } = nodes[index];
        expect(fiber.child === links[index][0]).toBe(true);
        expect(fiber.sibling === links[index][1]).toBe(true);
        expect(fiber.return === links[index][2]).toBe(true);
      }
    }
  });

  it("keeps pending sibling stacks isolated across concurrent and reentrant traversals", async () => {
    const nodes = createTree(createSeededRandom(seed));
    const expected = getPreorder(nodes[0]);
    const targets = [null, expected[0], expected[17], expected.at(-1)];
    await Promise.all(
      targets.map(async (target) => {
        const visited: Fiber[] = [];
        const result = await traverseFiber(nodes[0].fiber, async (fiber) => {
          visited.push(fiber);
          expect(traverseFiber(fiber, (candidate) => candidate === fiber)).toBe(fiber);
          await Promise.resolve();
          return fiber === target;
        });
        expect(result === target).toBe(true);
        const stopIndex = target ? expected.indexOf(target) : -1;
        expectIdenticalOrder(
          visited,
          stopIndex < 0 ? expected : expected.slice(0, stopIndex + 1),
          `seed ${seed}`,
        );
      }),
    );
  });
});

it.each(["sync", "async", "after-async"])(
  "propagates %s failures at every position without visiting later nodes",
  async (mode) => {
    const nodes = createTree(createSeededRandom(42));
    const expected = getPreorder(nodes[0]);
    for (let failureIndex = 0; failureIndex < expected.length; failureIndex++) {
      const failure = new Error(`failure at ${failureIndex}`);
      const visited: Fiber[] = [];
      const run = () =>
        traverseFiber(nodes[0].fiber, (fiber) => {
          visited.push(fiber);
          if (fiber === expected[failureIndex]) {
            if (mode === "async") return Promise.reject(failure);
            throw failure;
          }
          return mode === "sync" ? false : Promise.resolve(false);
        });
      if (mode === "sync" || (mode === "after-async" && failureIndex === 0)) {
        expect(run).toThrow(failure);
      } else {
        await expect(run()).rejects.toBe(failure);
      }
      expectIdenticalOrder(visited, expected.slice(0, failureIndex + 1), `${mode} ${failureIndex}`);
    }
  },
);

it("assimilates thenables exactly once and selects only literal true", async () => {
  const root = createFiber();
  const children = Array.from({ length: 5 }, () => createFiber());
  linkChildren(root, children);
  const results: unknown[] = [1, "true", {}, undefined, false, true];
  let visits = 0;
  let resolutions = 0;
  const result = Reflect.apply(traverseFiber, undefined, [
    root,
    () => {
      const value = results[visits++];
      return {
        // oxlint-disable-next-line unicorn/no-thenable -- Deliberately exercise non-native PromiseLike assimilation.
        then: (resolve: (value: unknown) => void) => {
          resolutions++;
          resolve(value);
          resolve(true);
        },
      };
    },
  ]);
  expect(await result).toBe(children[4]);
  expect(visits).toBe(6);
  expect(resolutions).toBe(6);
});
