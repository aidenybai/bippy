import type * as ReactNamespace from "react";
import type { UseFiberAttackContext } from "./use-fiber-attack-scenarios.js";
import { checkCallingFiber, createFiberRootRegistry, matchByProps } from "./use-fiber-oracle.js";

export interface UseFiberFuzzOptions extends UseFiberAttackContext {
  operationCount: number;
  seed: number;
}

export interface UseFiberFuzzReport {
  failures: string[];
  operationCount: number;
  operationHistogram: Record<string, number>;
  renderCount: number;
  seed: number;
}

interface NodeProps {
  nodeId: number;
  version: number;
}

interface NodeState {
  isMounted: boolean;
  keyGeneration: number;
  shouldThrow: boolean;
  suspension: { promise: Promise<void>; resolve: () => void } | null;
}

interface TreeState {
  nodes: NodeState[];
  parentVersion: number;
}

type ReactElement = ReactNamespace.ReactElement;

const nodeCount = 24;

// mulberry32: deterministic 32-bit PRNG so every failure is reproducible from its seed.
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const nextMacrotask = (): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 4; tick += 1) await nextMacrotask();
};

export const runUseFiberFuzz = async (
  options: UseFiberFuzzOptions,
): Promise<UseFiberFuzzReport> => {
  const { React, ReactDOM, ReactDOMClient, isDevelopment, operationCount, seed, useFiber } =
    options;
  const random = createRandom(seed);
  const registry = createFiberRootRegistry();
  const failures: string[] = [];
  const operationHistogram: Record<string, number> = {};
  const originalBind = Function.prototype.bind;
  let renderCount = 0;
  let operationIndex = 0;
  let currentOperation = "mount";

  const fail = (message: string): void => {
    failures.push(`seed=${seed} operation=${operationIndex} (${currentOperation}): ${message}`);
  };

  const nodeUpdaters = new Map<
    number,
    ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>>
  >();
  const treeState: TreeState = {
    nodes: Array.from({ length: nodeCount }, () => ({
      isMounted: true,
      keyGeneration: 0,
      shouldThrow: false,
      suspension: null,
    })),
    parentVersion: 0,
  };
  let setTreeVersion: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};

  const Node = (props: NodeProps): ReactElement | null => {
    const fiber = useFiber();
    renderCount += 1;
    try {
      const mismatch = checkCallingFiber(registry, matchByProps(Node, props), fiber, isDevelopment);
      if (mismatch) fail(`node ${props.nodeId} mismatch ${JSON.stringify(mismatch)}`);
    } catch (error) {
      fail(`oracle error ${error instanceof Error ? error.message : String(error)}`);
    }
    const [, setLocalVersion] = React.useState(0);
    nodeUpdaters.set(props.nodeId, setLocalVersion);
    const node = treeState.nodes[props.nodeId];
    if (node.suspension) throw node.suspension.promise;
    if (node.shouldThrow) throw new Error("fuzz throw");
    return React.createElement("i", null, props.version);
  };
  const MemoNode = React.memo(Node);

  class Boundary extends React.Component<
    { children?: ReactElement; resetKey: number },
    { error: unknown }
  > {
    state = { error: null };

    static getDerivedStateFromError(error: unknown): { error: unknown } {
      return { error };
    }

    override componentDidUpdate(previousProps: { resetKey: number }): void {
      if (previousProps.resetKey !== this.props.resetKey && this.state.error)
        this.setState({ error: null });
    }

    override render(): ReactElement | null {
      return this.state.error ? null : (this.props.children ?? null);
    }
  }

  const Tree = (): ReactElement => {
    const [version, setVersion] = React.useState(0);
    setTreeVersion = setVersion;
    const children: ReactElement[] = [];
    for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
      const node = treeState.nodes[nodeId];
      if (!node.isMounted) continue;
      const Component = nodeId % 2 === 0 ? MemoNode : Node;
      const nodeProps: NodeProps = { nodeId, version: nodeId % 3 === 0 ? version : 0 };
      children.push(
        React.createElement(
          Boundary,
          { key: `${nodeId}:${node.keyGeneration}`, resetKey: node.keyGeneration + version },
          React.createElement(
            React.Suspense,
            { fallback: null },
            React.createElement(Component, nodeProps),
          ),
        ),
      );
    }
    return React.createElement("div", { "data-version": version }, children);
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  registry.addContainer(container);
  const isConcurrent = ReactDOMClient !== null;
  const concurrentRoot = ReactDOMClient?.createRoot(container) ?? null;
  const rerenderTree = (): void => {
    if (concurrentRoot) {
      ReactDOM.flushSync(() => concurrentRoot.render(React.createElement(Tree)));
      return;
    }
    ReactDOM.render?.(React.createElement(Tree), container);
  };
  const previousConsoleError = console.error;
  console.error = () => {};
  rerenderTree();

  const flushTreeUpdate = (): void =>
    ReactDOM.flushSync(() => setTreeVersion((version) => version + 1));

  const operations: Array<[string, () => Promise<void> | void]> = [
    [
      "node-update",
      () => {
        const nodeId = Math.floor(random() * nodeCount);
        const update = nodeUpdaters.get(nodeId);
        if (update && treeState.nodes[nodeId].isMounted) {
          ReactDOM.flushSync(() => update((version) => version + 1));
        }
      },
    ],
    ["parent-update", flushTreeUpdate],
    [
      "toggle-mount",
      () => {
        const node = treeState.nodes[Math.floor(random() * nodeCount)];
        node.isMounted = !node.isMounted;
        flushTreeUpdate();
      },
    ],
    [
      "remount-key",
      () => {
        const node = treeState.nodes[Math.floor(random() * nodeCount)];
        node.keyGeneration += 1;
        flushTreeUpdate();
      },
    ],
    [
      "suspend-then-resolve",
      async () => {
        const nodeId = Math.floor(random() * nodeCount);
        const node = treeState.nodes[nodeId];
        const update = nodeUpdaters.get(nodeId);
        if (!node.isMounted || !update || node.suspension) return;
        let resolveSuspension = (): void => {};
        const promise = new Promise<void>((resolve) => {
          resolveSuspension = resolve;
        });
        node.suspension = { promise, resolve: resolveSuspension };
        ReactDOM.flushSync(() => update((version) => version + 1));
        if (random() < 0.5) flushTreeUpdate();
        node.suspension = null;
        resolveSuspension();
        await settle();
      },
    ],
    [
      "throw-then-recover",
      () => {
        const nodeId = Math.floor(random() * nodeCount);
        const node = treeState.nodes[nodeId];
        const update = nodeUpdaters.get(nodeId);
        if (!node.isMounted || !update) return;
        node.shouldThrow = true;
        ReactDOM.flushSync(() => update((version) => version + 1));
        node.shouldThrow = false;
        node.keyGeneration += 1;
        flushTreeUpdate();
      },
    ],
    [
      "transition-update",
      async () => {
        if (!isConcurrent) return;
        const nodeId = Math.floor(random() * nodeCount);
        const update = nodeUpdaters.get(nodeId);
        if (!update || !treeState.nodes[nodeId].isMounted) return;
        React.startTransition(() => update((version) => version + 1));
        if (random() < 0.5) flushTreeUpdate();
        await settle();
      },
    ],
    [
      "root-churn",
      () => {
        if (concurrentRoot) {
          ReactDOM.flushSync(() => concurrentRoot.render(React.createElement("div")));
        } else {
          ReactDOM.unmountComponentAtNode?.(container);
        }
        nodeUpdaters.clear();
        rerenderTree();
      },
    ],
  ];

  try {
    for (operationIndex = 1; operationIndex <= operationCount; operationIndex += 1) {
      const [name, run] = operations[Math.floor(random() * operations.length)];
      currentOperation = name;
      operationHistogram[name] = (operationHistogram[name] ?? 0) + 1;
      try {
        await run();
      } catch (error) {
        fail(`threw ${error instanceof Error ? error.message : String(error)}`);
      }
      if (Function.prototype.bind !== originalBind) {
        fail("Function.prototype.bind was not restored");
        Function.prototype.bind = originalBind;
      }
      if (failures.length > 20) break;
    }
  } finally {
    console.error = previousConsoleError;
    if (concurrentRoot) {
      ReactDOM.flushSync(() => concurrentRoot.unmount());
    } else {
      ReactDOM.unmountComponentAtNode?.(container);
    }
    container.remove();
  }

  return { failures, operationCount: operationIndex - 1, operationHistogram, renderCount, seed };
};
