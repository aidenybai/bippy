import { traverseFiber, type Fiber } from "bippy";
import { describe, expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface ControlledTraversal {
  visited: Fiber[];
  gate: ReturnType<typeof Promise.withResolvers<boolean>>;
  progress: ReturnType<typeof Promise.withResolvers<void>>;
  stopIndex: number;
  failureIndex: number;
  isFinished: boolean;
  result?: Fiber | null;
  error?: unknown;
}

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

const runInterleavedTraversal = async (seed: number): Promise<string[]> => {
  const getRandom = createSeededRandom(seed);
  const nodes = createTree(getRandom);
  const expected = getPreorder(nodes[0]);
  const failure = new Error(`rejected traversal, seed ${seed}`);
  const runs: ControlledTraversal[] = Array.from({ length: 3 }, (_, index) => ({
    visited: [],
    gate: Promise.withResolvers<boolean>(),
    progress: Promise.withResolvers<void>(),
    stopIndex: index === 1 ? 10 + getRandom(70) : -1,
    failureIndex: index === 2 ? 10 + getRandom(70) : -1,
    isFinished: false,
  }));
  const handoffs = Array.from({ length: expected.length * runs.length }, () =>
    getRandom(runs.length),
  );
  const transcript: string[] = [];
  const completions = runs.map((run) =>
    Promise.resolve(
      traverseFiber(nodes[0].fiber, (fiber) => {
        run.visited.push(fiber);
        run.gate = Promise.withResolvers<boolean>();
        run.progress.resolve();
        return run.gate.promise;
      }),
    ).then(
      (result) => {
        run.result = result;
        run.isFinished = true;
        run.progress.resolve();
      },
      (error: unknown) => {
        run.error = error;
        run.isFinished = true;
        run.progress.resolve();
      },
    ),
  );

  let step = 0;
  while (runs.some((run) => !run.isFinished)) {
    expect(step, `bounded schedule, seed ${seed}`).toBeLessThan(handoffs.length);
    const active = runs.filter((run) => !run.isFinished);
    const run = active[handoffs[step] % active.length];
    const snapshots = runs.map((innerRun) => [...innerRun.visited]);
    const index = run.visited.length - 1;
    run.progress = Promise.withResolvers<void>();
    if (index === run.failureIndex) run.gate.reject(failure);
    else run.gate.resolve(index === run.stopIndex);
    await run.progress.promise;
    const context = `seed ${seed}, handoff ${step++}`;
    transcript.push(
      JSON.stringify(
        runs.map((innerRun) => ({
          visits: innerRun.visited.map((fiber) => fiber.key),
          isFinished: innerRun.isFinished,
          result: innerRun.result?.key ?? innerRun.result,
          didReject: innerRun.error === failure,
        })),
      ),
    );
    for (const [runIndex, checkedRun] of runs.entries()) {
      expectIdenticalOrder(
        checkedRun.visited,
        checkedRun === run ? expected.slice(0, checkedRun.visited.length) : snapshots[runIndex],
        context,
      );
    }
    expect(run.visited.length, context).toBe(
      snapshots[runs.indexOf(run)].length + (run.isFinished ? 0 : 1),
    );
  }
  await Promise.all(completions);
  for (const run of runs) {
    const endIndex = run.stopIndex >= 0 ? run.stopIndex : run.failureIndex;
    expectIdenticalOrder(
      run.visited,
      endIndex < 0 ? expected : expected.slice(0, endIndex + 1),
      `seed ${seed}`,
    );
    expect(run.error).toBe(run.failureIndex >= 0 ? failure : undefined);
    expect(run.result).toBe(run.failureIndex >= 0 ? undefined : (expected[run.stopIndex] ?? null));
  }
  const finalVisits: Fiber[] = [];
  expect(
    traverseFiber(nodes[0].fiber, (fiber) => {
      finalVisits.push(fiber);
    }),
  ).toBeNull();
  expectIdenticalOrder(finalVisits, expected, `fresh traversal, seed ${seed}`);
  return transcript;
};

it.each(fuzzSeeds)(
  "replays identical explicitly interleaved completion, rejection and early stop, seed %i",
  async (seed) => {
    const first = await runInterleavedTraversal(seed);
    const second = await runInterleavedTraversal(seed);
    expect(second, `replay seed ${seed}`).toEqual(first);
  },
);

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
