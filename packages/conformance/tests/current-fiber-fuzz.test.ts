import { getFiberById, getFiberId, getLatestFiber, getReactWorkTags, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { createFiber, getFiberPreorder, linkChildren } from "./fiber-fixture.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface FiberPair {
  previous: Fiber;
  current: Fiber;
  children: FiberPair[];
}

const createPair = (key: string, tag = getReactWorkTags().FunctionComponent): FiberPair => {
  const previous = createFiber({ key, tag, actualStartTime: 1000 });
  const current = createFiber({ key, tag, actualStartTime: -1.1, alternate: previous });
  previous.alternate = current;
  return { previous, current, children: [] };
};

it.each(fuzzSeeds)(
  "resolves nested bailout child sets and shared return pointers against root reachability, seed %i",
  (seed) => {
    const getRandom = createSeededRandom(seed);
    for (let iteration = 0; iteration < 40; iteration++) {
      const rootPair = createPair("root", getReactWorkTags().HostRoot);
      const root = { current: rootPair.current };
      rootPair.previous.stateNode = rootPair.current.stateNode = root;
      const pairs = [rootPair];
      for (let index = 1; index < 80; index++) {
        const pair = createPair(String(index));
        pairs[getRandom(pairs.length)].children.push(pair);
        pairs.push(pair);
      }
      for (const pair of pairs) {
        linkChildren(
          pair.previous,
          pair.children.map((child) => child.previous),
        );
        linkChildren(
          pair.current,
          pair.children.map((child) => child.current),
        );
        for (const child of pair.children) {
          const returnMode = getRandom(3);
          if (returnMode === 1) child.current.return = pair.previous;
          if (returnMode === 2) child.previous.return = pair.current;
        }
        const bailoutMode = getRandom(3);
        if (bailoutMode === 1) pair.current.child = pair.previous.child;
        if (bailoutMode === 2) pair.previous.child = pair.current.child;
      }
      for (const currentRoot of [rootPair.current, rootPair.previous, rootPair.current]) {
        root.current = currentRoot;
        const reachable = getFiberPreorder(currentRoot);
        for (const expected of reachable) {
          const context = JSON.stringify({
            seed,
            iteration,
            key: expected.key,
            currentRoot: currentRoot === rootPair.current,
          });
          expect(getLatestFiber(expected) === expected, context).toBe(true);
          if (!expected.alternate) throw new Error(`Missing alternate: ${context}`);
          expect(getLatestFiber(expected.alternate) === expected, context).toBe(true);
          const identifier = getFiberId(expected);
          expect(getFiberId(expected.alternate), context).toBe(identifier);
          expect(getFiberById(identifier) === expected, context).toBe(true);
        }
      }
    }
  },
);
