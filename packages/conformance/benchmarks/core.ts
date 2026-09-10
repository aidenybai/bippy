import assert from "node:assert/strict";
import type { Fiber, FiberRoot, ReactDevToolsTarget, ReactRenderer } from "bippy";
import {
  benchmarkCase,
  createBenchmarkSuite,
  equals,
  type BenchmarkCase,
  type BenchmarkContext,
} from "./harness.js";
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
  nextRootFiber: Fiber;
}

interface TypeWrapper {
  type?: unknown;
}

const treeShapes: Array<"deep" | "wide"> = ["deep", "wide"];

export const createCoreBenchmarks = ({
  Bippy,
  React,
  ReactDOM,
  ReactDOMClient,
}: BenchmarkContext): BenchmarkCase[] => {
  const { cases, add } = createBenchmarkSuite("bippy");
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
      const previousTree = createTree(size, shape);
      const nextTree = createTree(size, shape);
      pairTrees(previousTree, nextTree);
      const leaf = previousTree.fibers[size - 1];
      const selected = nextTree.fibers[size - 1];
      add(
        "traverseFiber",
        `${shape}-${size}-tail`,
        () => Bippy.traverseFiber(nextTree.root.current, (fiber) => fiber === selected),
        equals(selected),
      );
      add(
        "traverseFiber",
        `${shape}-${size}-miss`,
        () => Bippy.traverseFiber(nextTree.root.current, () => false),
        equals(null),
      );
      add(
        "getLatestFiber",
        `${shape}-${size}-alternate`,
        () => Bippy.getLatestFiber(leaf),
        equals(selected),
      );
      Bippy.setReactWorkTagsForFiber(previousTree.root.current, renderer);
      Bippy.getReactWorkTagsForFiber(leaf);
      add(
        "getReactWorkTagsForFiber",
        `${shape}-${size}-warm`,
        () => Bippy.getReactWorkTagsForFiber(leaf),
        equals(workTags),
      );
      const currentRoot = nextTree.root;
      cases.push(
        benchmarkCase(
          `traverseRenderedFibers/${shape}-${size}-update`,
          ["bippy#traverseRenderedFibers"],
          () => {
            currentRoot.current = currentRoot.current.alternate ?? currentRoot.current;
            let visitedFiberCount = 0;
            Bippy.traverseRenderedFibers(currentRoot, (_fiber, phase) => {
              if (phase === "update") visitedFiberCount++;
            });
            return visitedFiberCount;
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
    const previousTree = createTree(size, "wide");
    const nextTree = createTree(size, "wide");
    pairTrees(previousTree, nextTree);
    previousTree.root.current.alternate = null;
    add(
      "getLatestFiber",
      `synthetic-root-search-${size}`,
      () => Bippy.getLatestFiber(previousTree.fibers[size - 1]),
      equals(nextTree.fibers[size - 1]),
    );
    let commits: SuspenseCommit[] = [];
    cases.push(
      benchmarkCase(
        `traverseRenderedFibers/suspense-hide-${size}`,
        ["bippy#traverseRenderedFibers"],
        (iteration) => {
          const commit = commits[iteration];
          commit.root.current = commit.nextRootFiber;
          let unmountedFiberCount = 0;
          Bippy.traverseRenderedFibers(commit.root, (_fiber, phase) => {
            if (phase === "unmount") unmountedFiberCount++;
          });
          return unmountedFiberCount;
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
              const nextRootFiber = createFiber({
                tag: workTags.HostRoot,
                alternate: tree.root.current,
                memoizedState: tree.root.current.memoizedState,
              });
              nextRootFiber.child = createFiber({
                tag: workTags.SuspenseComponent,
                alternate: boundary,
                return: nextRootFiber,
                memoizedState: { memoizedState: null, next: null },
              });
              Bippy.traverseRenderedFibers(tree.root, () => {});
              return { root: tree.root, nextRootFiber };
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
      { isAsync: true, units: 1001 },
    ),
  );

  for (const size of [100, 1000]) {
    let tagTrees: FiberTree[] = [];
    cases.push(
      benchmarkCase(
        `getReactWorkTagsForFiber/deep-${size}-cold`,
        ["bippy#getReactWorkTagsForFiber", "bippy#setReactWorkTagsForFiber"],
        (iteration) => Bippy.getReactWorkTagsForFiber(tagTrees[iteration].fibers[size - 1]),
        equals(workTags),
        {
          prepare: (iterations) => {
            tagTrees = Array.from({ length: iterations }, () => createTree(size, "deep"));
            for (const tree of tagTrees)
              Bippy.setReactWorkTagsForFiber(tree.root.current, renderer);
          },
          maxIterations: 16,
          units: size,
        },
      ),
    );
    let mountTrees: FiberTree[] = [];
    cases.push(
      benchmarkCase(
        `traverseRenderedFibers/wide-${size}-mount`,
        ["bippy#traverseRenderedFibers"],
        (iteration) => {
          let visitedFiberCount = 0;
          Bippy.traverseRenderedFibers(mountTrees[iteration].root, (_fiber, phase) => {
            if (phase === "mount") visitedFiberCount++;
          });
          return visitedFiberCount;
        },
        equals(size + 1),
        {
          prepare: (iterations) => {
            mountTrees = Array.from({ length: iterations }, () => createTree(size, "wide"));
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
  const trackedTree = createTree(1000, "deep");
  let rendererId: number | undefined;
  cases.push(
    benchmarkCase(
      "getRenderer/deep-1000-warm",
      ["bippy#getRenderer"],
      () => Bippy.getRenderer(trackedTree.fibers[999], target),
      equals(renderer),
      {
        prepare: () => {
          if (rendererId !== undefined) return;
          rendererId = hook.inject(renderer);
          hook.getFiberRoots?.(rendererId).add(trackedTree.root);
          Bippy.getRenderer(trackedTree.fibers[999], target);
        },
        cleanup: () => {
          if (rendererId !== undefined) {
            hook.getFiberRoots?.(rendererId).delete(trackedTree.root);
            hook.renderers.delete(rendererId);
          }
          Bippy._fiberRoots.delete(trackedTree.root);
          Bippy._renderers.delete(renderer);
          rendererId = undefined;
        },
      },
    ),
  );
  for (const name of ["getFiber", "getRenderer"]) {
    let container: HTMLDivElement | undefined;
    let domRoot: ReturnType<typeof ReactDOMClient.createRoot> | undefined;
    let domFiber: Fiber | null = null;
    let expected: Fiber | ReactRenderer | null = null;
    cases.push(
      benchmarkCase(
        `${name}/live-dom`,
        [`bippy#${name}`],
        () => {
          assert.ok(domFiber);
          return name === "getFiber"
            ? Bippy.getFiber(container?.firstChild)
            : Bippy.getRenderer(domFiber);
        },
        (value) => assert.equal(value, expected),
        {
          prepare: () => {
            if (domRoot) return;
            container = document.createElement("div");
            document.body.appendChild(container);
            domRoot = ReactDOMClient.createRoot(container);
            ReactDOM.flushSync(() => domRoot?.render(React.createElement("span")));
            domFiber = Bippy.getFiber(container.firstChild);
            assert.ok(domFiber);
            expected = name === "getFiber" ? domFiber : Bippy.getRenderer(domFiber);
            assert.ok(expected);
          },
          cleanup: () => {
            ReactDOM.flushSync(() => domRoot?.unmount());
            container?.remove();
            domRoot = undefined;
            domFiber = null;
          },
        },
      ),
    );
  }
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
