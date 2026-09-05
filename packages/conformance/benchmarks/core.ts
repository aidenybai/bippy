import assert from "node:assert/strict";
import type { Fiber, FiberRoot, ReactDevToolsTarget, ReactRenderer } from "bippy";
import { benchmarkCase, type BenchmarkCase, type BenchmarkContext } from "./harness.js";
import {
  Component,
  createFiber,
  createTree,
  linkChildren,
  pairTrees,
  type FiberTree,
} from "./fixtures.js";

interface SuspenseCommit {
  root: FiberRoot;
  next: Fiber;
}

interface TypeWrapper {
  type?: unknown;
}

const treeShapes: Array<"deep" | "wide"> = ["deep", "wide"];
const equals =
  (expected: unknown) =>
  (value: unknown): void =>
    assert.equal(value, expected);

export const createCoreBenchmarks = ({
  Bippy,
  React,
  ReactDOM,
  ReactDOMClient,
}: BenchmarkContext): BenchmarkCase[] => {
  const cases: BenchmarkCase[] = [];
  const add = (
    name: string,
    scenario: string,
    run: BenchmarkCase["run"],
    verify: BenchmarkCase["verify"],
  ) => cases.push(benchmarkCase(`${name}/${scenario}`, [`bippy#${name}`], run, verify));
  const renderer: ReactRenderer = {
    version: "19.2.4",
    rendererPackageName: "benchmark",
    bundleType: 1,
  };
  const workTags = Bippy.getReactWorkTags();
  const component = createFiber({ type: Component });
  const host = createFiber({ tag: workTags.HostComponent, type: "div" });
  const element = React.createElement("div");
  const forgedElement = { $$typeof: Symbol.for("not-react") };
  cases.push(benchmarkCase("harness/sync-baseline", [], () => true, equals(true)));
  add("isValidElement", "valid", () => Bippy.isValidElement(element), equals(true));
  add("isValidElement", "forged-symbol", () => Bippy.isValidElement(forgedElement), equals(false));
  add("isFiber", "valid", () => Bippy.isFiber(component), equals(true));
  add("isHostFiber", "host", () => Bippy.isHostFiber(host), equals(true));
  add("isCompositeFiber", "component", () => Bippy.isCompositeFiber(component), equals(true));
  add("didFiberRender", "performed-work", () => Bippy.didFiberRender(component), equals(true));
  const unchanged = createFiber({
    alternate: host,
    tag: workTags.HostComponent,
    memoizedProps: host.memoizedProps,
  });
  add("didFiberRender", "unchanged-host", () => Bippy.didFiberRender(unchanged), equals(false));
  const memoized = createFiber();
  Reflect.set(memoized, "updateQueue", { memoCache: { data: [], index: 0 } });
  add("hasMemoCache", "present", () => Bippy.hasMemoCache(memoized), equals(true));
  add(
    "compareSemver",
    "prerelease",
    () => Bippy.compareSemver("19.2.4-canary.10", "19.2.4-canary.2"),
    equals(1),
  );
  add(
    "getReactWorkTags",
    "versioned",
    () => Bippy.getReactWorkTags("16.0.0"),
    equals(Bippy.getReactWorkTags("16.0.0")),
  );
  add(
    "getReactWorkTagsForRenderer",
    "versioned",
    () => Bippy.getReactWorkTagsForRenderer(renderer),
    equals(workTags),
  );
  add(
    "detectReactBuildType",
    "development",
    () => Bippy.detectReactBuildType(renderer),
    equals("development"),
  );
  const identifier = Bippy.getFiberId(component);
  add("getFiberId", "warm", () => Bippy.getFiberId(component), equals(identifier));
  cases.push(
    benchmarkCase(
      "setFiberId/existing-id",
      ["bippy#setFiberId"],
      () => Bippy.setFiberId(component, identifier),
      () => assert.equal(Bippy.getFiberId(component), identifier),
      { maxIterations: 128 },
    ),
  );
  let coldFibers: Fiber[] = [];
  cases.push(
    benchmarkCase(
      "getFiberId/cold",
      ["bippy#getFiberId"],
      (iteration) => Bippy.getFiberId(coldFibers[iteration]),
      (value) => assert.equal(typeof value, "number"),
      {
        prepare: (iterations) => {
          coldFibers = Array.from({ length: iterations }, () => createFiber());
        },
        maxIterations: 128,
      },
    ),
  );
  add("getFiberById", "hit", () => Bippy.getFiberById(identifier), equals(component));
  add("getFiberById", "miss", () => Bippy.getFiberById(-1), equals(null));
  add("getLatestFiber", "no-alternate", () => Bippy.getLatestFiber(component), equals(component));
  add("getType", "plain", () => Bippy.getType(Component), equals(Component));
  add("getDisplayName", "plain", () => Bippy.getDisplayName(Component), equals("Component"));
  for (const depth of [10, 1000]) {
    let wrapper: unknown = Component;
    for (let index = 0; index < depth; index++) wrapper = { type: wrapper };
    add("getType", `wrappers-${depth}`, () => Bippy.getType(wrapper), equals(Component));
    add(
      "getDisplayName",
      `wrappers-${depth}`,
      () => Bippy.getDisplayName(wrapper),
      equals("Component"),
    );
  }
  const cyclic: TypeWrapper = {};
  cyclic.type = cyclic;
  add("getType", "cycle", () => Bippy.getType(cyclic), equals(null));

  for (const size of [100, 1000, 10000]) {
    for (const shape of treeShapes) {
      const previous = createTree(size, shape);
      const next = createTree(size, shape);
      pairTrees(previous, next);
      const leaf = previous.fibers[size - 1];
      const selected = next.fibers[size - 1];
      add(
        "traverseFiber",
        `${shape}-${size}-tail`,
        () => Bippy.traverseFiber(next.root.current, (fiber) => fiber === selected),
        equals(selected),
      );
      add(
        "traverseFiber",
        `${shape}-${size}-miss`,
        () => Bippy.traverseFiber(next.root.current, () => false),
        equals(null),
      );
      add(
        "getLatestFiber",
        `${shape}-${size}-alternate`,
        () => Bippy.getLatestFiber(leaf),
        equals(selected),
      );
      Bippy.setReactWorkTagsForFiber(previous.root.current, renderer);
      Bippy.getReactWorkTagsForFiber(leaf);
      add(
        "getReactWorkTagsForFiber",
        `${shape}-${size}-warm`,
        () => Bippy.getReactWorkTagsForFiber(leaf),
        equals(workTags),
      );
      const currentRoot = next.root;
      cases.push(
        benchmarkCase(
          `traverseRenderedFibers/${shape}-${size}-update`,
          ["bippy#traverseRenderedFibers"],
          () => {
            currentRoot.current = currentRoot.current.alternate ?? currentRoot.current;
            let visited = 0;
            Bippy.traverseRenderedFibers(currentRoot, (_fiber, phase) => {
              if (phase === "update") visited++;
            });
            return visited;
          },
          equals(size + 1),
          {
            prepare: () => {
              Bippy.traverseRenderedFibers(currentRoot, () => {});
            },
            units: size + 1,
          },
        ),
      );
    }
  }
  for (const size of [100, 1000, 10000]) {
    const previous = createTree(size, "wide");
    const next = createTree(size, "wide");
    pairTrees(previous, next);
    previous.root.current.alternate = null;
    add(
      "getLatestFiber",
      `synthetic-root-search-${size}`,
      () => Bippy.getLatestFiber(previous.fibers[size - 1]),
      equals(next.fibers[size - 1]),
    );
    let commits: SuspenseCommit[] = [];
    cases.push(
      benchmarkCase(
        `traverseRenderedFibers/suspense-hide-${size}`,
        ["bippy#traverseRenderedFibers"],
        (iteration) => {
          const commit = commits[iteration];
          commit.root.current = commit.next;
          let unmounted = 0;
          Bippy.traverseRenderedFibers(commit.root, (_fiber, phase) => {
            if (phase === "unmount") unmounted++;
          });
          return unmounted;
        },
        equals(size),
        {
          prepare: (iterations) => {
            commits = Array.from({ length: iterations }, () => {
              const tree = createTree(size, "wide");
              const boundary = createFiber({
                tag: workTags.SuspenseComponent,
                return: tree.root.current,
              });
              const offscreen = createFiber({
                tag: workTags.OffscreenComponent,
                return: boundary,
                child: tree.root.current.child,
              });
              boundary.child = offscreen;
              tree.root.current.child = boundary;
              for (const fiber of tree.fibers) fiber.return = offscreen;
              const next = createFiber({
                tag: workTags.HostRoot,
                alternate: tree.root.current,
                memoizedState: tree.root.current.memoizedState,
              });
              next.child = createFiber({
                tag: workTags.SuspenseComponent,
                alternate: boundary,
                return: next,
                memoizedState: { memoizedState: null, next: null },
              });
              Bippy.traverseRenderedFibers(tree.root, () => {});
              return { root: tree.root, next };
            });
          },
          maxIterations: 4,
          units: size,
        },
      ),
    );
  }
  const ascending = createTree(1000, "deep");
  add(
    "traverseFiber",
    "ascending-1000",
    () =>
      Bippy.traverseFiber(ascending.fibers[999], (fiber) => fiber === ascending.root.current, true),
    equals(ascending.root.current),
  );
  cases.push(
    benchmarkCase(
      "traverseFiber/async-1000",
      ["bippy#traverseFiber"],
      () => Bippy.traverseFiber(ascending.root.current, async () => false),
      equals(null),
      { async: true, units: 1001 },
    ),
  );

  for (const size of [100, 1000]) {
    let trees: FiberTree[] = [];
    cases.push(
      benchmarkCase(
        `getReactWorkTagsForFiber/deep-${size}-cold`,
        ["bippy#getReactWorkTagsForFiber", "bippy#setReactWorkTagsForFiber"],
        (iteration) => Bippy.getReactWorkTagsForFiber(trees[iteration].fibers[size - 1]),
        equals(workTags),
        {
          prepare: (iterations) => {
            trees = Array.from({ length: iterations }, () => createTree(size, "deep"));
            for (const tree of trees) Bippy.setReactWorkTagsForFiber(tree.root.current, renderer);
          },
          maxIterations: 16,
          units: size,
        },
      ),
    );
    cases.push(
      benchmarkCase(
        `traverseRenderedFibers/wide-${size}-mount`,
        ["bippy#traverseRenderedFibers"],
        (iteration) => {
          let visited = 0;
          Bippy.traverseRenderedFibers(trees[iteration].root, (_fiber, phase) => {
            if (phase === "mount") visited++;
          });
          return visited;
        },
        equals(size + 1),
        {
          prepare: (iterations) => {
            trees = Array.from({ length: iterations }, () => createTree(size, "wide"));
          },
          maxIterations: 16,
          units: size + 1,
        },
      ),
    );
  }
  const tagTree = createTree(1000, "deep");
  let revision = 0;
  add(
    "setReactWorkTagsForFiber",
    "unchanged",
    () => Bippy.setReactWorkTagsForFiber(component, renderer),
    () => assert.equal(Bippy.getReactWorkTagsForFiber(component), workTags),
  );
  add(
    "setReactWorkTagsForFiber",
    "change-and-revalidate-1000",
    () => {
      revision++;
      const version = revision % 2 ? "16.0.0" : "19.2.4";
      Bippy.setReactWorkTagsForFiber(tagTree.root.current, { ...renderer, version });
      return Bippy.getReactWorkTagsForFiber(tagTree.fibers[999]);
    },
    (value) => assert.equal(value, Bippy.getReactWorkTags(revision % 2 ? "16.0.0" : "19.2.4")),
  );

  const target: ReactDevToolsTarget = {};
  const hook = Bippy.getRDTHook(undefined, target);
  const rendererId = hook.inject(renderer);
  const tracked = createTree(1000, "deep");
  hook.getFiberRoots?.(rendererId).add(tracked.root);
  Bippy.getRenderer(tracked.fibers[999], target);
  cases.push(
    benchmarkCase(
      "getRenderer/deep-1000-warm",
      ["bippy#getRenderer"],
      () => Bippy.getRenderer(tracked.fibers[999], target),
      equals(renderer),
      {
        cleanup: () => {
          Bippy._fiberRoots.delete(tracked.root);
          Bippy._renderers.delete(renderer);
        },
      },
    ),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const domRoot = ReactDOMClient.createRoot(container);
  ReactDOM.flushSync(() => domRoot.render(React.createElement("span")));
  const domFiber = Bippy.getFiber(container.firstChild);
  assert.ok(domFiber);
  const domRenderer = Bippy.getRenderer(domFiber);
  assert.ok(domRenderer);
  add("getFiber", "live-dom", () => Bippy.getFiber(container.firstChild), equals(domFiber));
  cases.push(
    benchmarkCase(
      "getRenderer/live-dom-warm",
      ["bippy#getRenderer"],
      () => Bippy.getRenderer(domFiber),
      equals(domRenderer),
      {
        cleanup: () => {
          ReactDOM.flushSync(() => domRoot.unmount());
          container.remove();
        },
      },
    ),
  );
  for (const size of [100, 1000]) {
    const nativeTarget: ReactDevToolsTarget = {};
    const nativeHook = Bippy.getRDTHook(undefined, nativeTarget);
    const nativeTree = createTree(size, "wide");
    const nativeFiber = createFiber({ tag: workTags.HostComponent, stateNode: { _nativeTag: 42 } });
    nativeTree.fibers[size - 1] = nativeFiber;
    linkChildren(nativeTree.root.current, nativeTree.fibers);
    nativeHook.renderers.set(1, renderer);
    nativeHook.getFiberRoots?.(1).add(nativeTree.root);
    add(
      "getFiber",
      `native-tag-root-search-${size}`,
      () => Bippy.getFiber(42, nativeTarget),
      equals(nativeFiber),
    );
  }
  const hostInstance = { __reactFiber$benchmark: host };
  assert.equal(Bippy.getFiberFromHostInstance, Bippy.getFiber);
  cases.push(
    benchmarkCase(
      "getFiber/property-warm",
      ["bippy#getFiber", "bippy#getFiberFromHostInstance"],
      () => Bippy.getFiber(hostInstance, target),
      equals(host),
    ),
  );
  const missingHost = {};
  const emptyTarget: ReactDevToolsTarget = {};
  add("getFiber", "miss", () => Bippy.getFiber(missingHost, emptyTarget), equals(null));
  const properties = Object.fromEntries(
    Array.from({ length: 1000 }, (_, index) => [`property${index}`, index]),
  );
  cases.push(
    benchmarkCase(
      "getFiber/enumerate-1000-properties-miss",
      ["bippy#getFiber"],
      () => Bippy.getFiber(properties, emptyTarget),
      equals(null),
    ),
  );

  const constructors = [
    { name: "BippyError", constructor: Bippy.BippyError },
    { name: "BippyHookInspectionError", constructor: Bippy.BippyHookInspectionError },
    { name: "BippyHookRenderError", constructor: Bippy.BippyHookRenderError },
    { name: "BippySourceMapError", constructor: Bippy.BippySourceMapError },
    { name: "BippyUnsupportedHookError", constructor: Bippy.BippyUnsupportedHookError },
  ];
  for (const entry of constructors) {
    cases.push(
      benchmarkCase(
        `${entry.name}/construct`,
        [`bippy#${entry.name}`, `bippy/source#${entry.name}`],
        () => new entry.constructor("benchmark"),
        (value) => assert.ok(value instanceof entry.constructor),
      ),
    );
  }
  add(
    "BippyError",
    "materialize-stack",
    () => new Bippy.BippyError("benchmark").stack,
    (value) => assert.equal(typeof value, "string"),
  );
  return cases;
};
