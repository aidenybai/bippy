// Property-based fiber fuzzing: a seeded generator builds random component
// trees mixing hosts, function components, memo, forwardRef, fragments,
// keyed lists, resolved-lazy Suspense, portals, and context pairs. Random
// mutations then reorder keys, toggle subtrees, retag hosts, and bump
// props, and after every commit a checker asserts bippy's invariants over
// the whole tree. Deterministic per seed so failures reproduce exactly.
import * as bippy from "bippy";
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

interface FuzzRng {
  (): number;
}

// mulberry32: tiny deterministic PRNG, good enough for structural fuzzing.
const createRng = (seed: number): FuzzRng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const pickInteger = (rng: FuzzRng, maxExclusive: number): number =>
  Math.floor(rng() * maxExclusive);

type SpecKind =
  | "host"
  | "text"
  | "component"
  | "memo"
  | "forward-ref"
  | "fragment"
  | "keyed-list"
  | "suspense"
  | "portal"
  | "context";

interface SpecNode {
  kind: SpecKind;
  specId: number;
  hostTag: "div" | "span" | "p";
  propValue: number;
  isHidden: boolean;
  keyOrder: number[];
  children: SpecNode[];
}

const HOST_TAGS: SpecNode["hostTag"][] = ["div", "span", "p"];

const generateSpecNode = (rng: FuzzRng, depth: number, nextSpecId: { value: number }): SpecNode => {
  const kinds: SpecKind[] =
    depth <= 0
      ? ["host", "text"]
      : [
          "host",
          "host",
          "text",
          "component",
          "memo",
          "forward-ref",
          "fragment",
          "keyed-list",
          "suspense",
          "portal",
          "context",
        ];
  const kind = kinds[pickInteger(rng, kinds.length)];
  const childCount = depth <= 0 || kind === "text" ? 0 : 1 + pickInteger(rng, 3);
  const children = Array.from({ length: childCount }, () =>
    generateSpecNode(rng, depth - 1, nextSpecId),
  );
  return {
    kind,
    specId: nextSpecId.value++,
    hostTag: HOST_TAGS[pickInteger(rng, HOST_TAGS.length)],
    propValue: pickInteger(rng, 100),
    isHidden: false,
    keyOrder: children.map((_, childIndex) => childIndex),
    children,
  };
};

const collectNodes = (node: SpecNode, collected: SpecNode[] = []): SpecNode[] => {
  collected.push(node);
  for (const child of node.children) collectNodes(child, collected);
  return collected;
};

// One mutation per step: prop bump, subtree visibility toggle, key
// shuffle, or host retag (forces a host remount at that position).
const mutateSpec = (rootSpec: SpecNode, rng: FuzzRng): string => {
  const candidates = collectNodes(rootSpec);
  const target = candidates[pickInteger(rng, candidates.length)];
  let mutationKind = pickInteger(rng, 4);
  if (mutationKind === 1 && target === rootSpec) {
    // Hiding the root would make every later invariant check vacuous.
    mutationKind = 0;
  }
  switch (mutationKind) {
    case 0:
      target.propValue = pickInteger(rng, 100);
      return `prop:${target.specId}`;
    case 1:
      target.isHidden = !target.isHidden;
      return `toggle:${target.specId}`;
    case 2: {
      for (let index = target.keyOrder.length - 1; index > 0; index--) {
        const swapIndex = pickInteger(rng, index + 1);
        [target.keyOrder[index], target.keyOrder[swapIndex]] = [
          target.keyOrder[swapIndex],
          target.keyOrder[index],
        ];
      }
      return `shuffle:${target.specId}`;
    }
    default:
      target.hostTag = HOST_TAGS[(HOST_TAGS.indexOf(target.hostTag) + 1) % HOST_TAGS.length];
      return `retag:${target.specId}`;
  }
};

const FuzzContext = React.createContext(0);

interface SpecProps {
  node: SpecNode;
}

const SpecChildren = ({ node }: SpecProps) => (
  <>
    {node.keyOrder.map((childIndex) => {
      const child = node.children[childIndex];
      return child ? <RenderSpec key={child.specId} node={child} /> : null;
    })}
  </>
);

const MemoSpec = React.memo(({ node }: SpecProps) => <SpecChildren node={node} />);

const ForwardRefSpec = React.forwardRef<HTMLDivElement, SpecProps>(({ node }, ref) => (
  <div ref={ref} data-fz={node.specId} data-prop={node.propValue}>
    <SpecChildren node={node} />
  </div>
));

const ContextValueSpec = ({ node }: SpecProps) => {
  const contextValue = React.useContext(FuzzContext);
  return (
    <span data-fz={node.specId} data-prop={contextValue}>
      <SpecChildren node={node} />
    </span>
  );
};

// The suspended child resolves synchronously so Suspense structures exist
// in the tree without timing nondeterminism.
const LazySpecChild = React.lazy(
  () =>
    ({
      then(onFulfilled: (payload: { default: React.ComponentType<SpecProps> }) => void) {
        onFulfilled({ default: SpecChildren });
      },
    }) as PromiseLike<{ default: React.ComponentType<SpecProps> }> as Promise<{
      default: React.ComponentType<SpecProps>;
    }>,
);

const RenderSpec = ({ node }: SpecProps): React.ReactNode => {
  if (node.isHidden) return null;
  switch (node.kind) {
    case "text":
      return `t${node.propValue}`;
    case "host":
      return React.createElement(
        node.hostTag,
        { "data-fz": node.specId, "data-prop": node.propValue },
        <SpecChildren node={node} />,
      );
    case "component":
      return (
        <div data-fz={node.specId} data-prop={node.propValue}>
          <SpecChildren node={node} />
        </div>
      );
    case "memo":
      return <MemoSpec node={node} />;
    case "forward-ref":
      return <ForwardRefSpec node={node} />;
    case "fragment":
    case "keyed-list":
      return <SpecChildren node={node} />;
    case "suspense":
      return (
        <React.Suspense fallback={null}>
          <LazySpecChild node={node} />
        </React.Suspense>
      );
    case "portal": {
      const portalTarget = document.getElementById("portal-target");
      if (!portalTarget) return null;
      return createPortal(
        <div data-fz={node.specId} data-prop={node.propValue}>
          <SpecChildren node={node} />
        </div>,
        portalTarget,
      );
    }
    case "context":
      return (
        <FuzzContext.Provider value={node.propValue}>
          <ContextValueSpec node={node} />
        </FuzzContext.Provider>
      );
  }
};

const waitForCommitToSettle = (): Promise<void> =>
  new Promise((resolveSettle) => {
    requestAnimationFrame(() => setTimeout(resolveSettle, 0));
  });

const checkInvariants = (failures: string[], step: string): number => {
  let checkedHostNodes = 0;
  for (const hostElement of document.querySelectorAll("[data-fz]")) {
    const specId = hostElement.getAttribute("data-fz");
    const fiber = bippy.getFiberFromHostInstance(hostElement);
    if (!fiber) {
      failures.push(`${step}: no fiber for host ${specId}`);
      continue;
    }
    checkedHostNodes++;
    if (!bippy.isHostFiber(fiber)) {
      failures.push(`${step}: fiber for ${specId} is not a host fiber`);
    }
    if (fiber.stateNode !== hostElement) {
      failures.push(`${step}: fiber.stateNode mismatch for ${specId}`);
    }
    const latestFiber = bippy.getLatestFiber(fiber);
    if (latestFiber.stateNode !== hostElement) {
      failures.push(`${step}: getLatestFiber resolved a different host for ${specId}`);
    }
    if (fiber.alternate && bippy.getFiberId(fiber) !== bippy.getFiberId(fiber.alternate)) {
      failures.push(`${step}: fiber id differs between alternates for ${specId}`);
    }
  }
  return checkedHostNodes;
};

interface FuzzRunResult {
  commitCount: number;
  mutationLog: string[];
  checkedHostNodes: number;
  failures: string[];
}

export const runFuzz = async (seed: number, mutationCount: number): Promise<FuzzRunResult> => {
  const rng = createRng(seed);
  const failures: string[] = [];
  const mutationLog: string[] = [];
  let commitCount = 0;
  let checkedHostNodes = 0;

  const validPhases = new Set(["mount", "update", "unmount"]);
  const unsubscribe = bippy.instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      commitCount++;
      try {
        bippy.traverseRenderedFibers(root, (_fiber, phase) => {
          if (!validPhases.has(phase)) {
            failures.push(`commit ${commitCount}: invalid phase ${String(phase)}`);
          }
        });
      } catch (error) {
        failures.push(`commit ${commitCount}: traverseRenderedFibers threw ${String(error)}`);
      }
    },
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const fuzzRoot: Root = createRoot(container);

  try {
    // Three generated subtrees under a fixed host root guarantee every
    // seed produces a tree with real breadth to check.
    const nextSpecId = { value: 1 };
    const rootSpec: SpecNode = {
      kind: "host",
      specId: 0,
      hostTag: "div",
      propValue: 0,
      isHidden: false,
      keyOrder: [0, 1, 2],
      children: Array.from({ length: 3 }, () => generateSpecNode(rng, 4, nextSpecId)),
    };
    fuzzRoot.render(<RenderSpec node={rootSpec} />);
    await waitForCommitToSettle();
    checkedHostNodes += checkInvariants(failures, "mount");

    for (let mutationIndex = 0; mutationIndex < mutationCount; mutationIndex++) {
      const mutationDescription = mutateSpec(rootSpec, rng);
      mutationLog.push(mutationDescription);
      fuzzRoot.render(<RenderSpec node={{ ...rootSpec }} />);
      await waitForCommitToSettle();
      checkedHostNodes += checkInvariants(failures, `mutation ${mutationDescription}`);
    }
  } finally {
    fuzzRoot.unmount();
    await waitForCommitToSettle();
    container.remove();
    unsubscribe();
  }

  return { commitCount, mutationLog, checkedHostNodes, failures };
};
