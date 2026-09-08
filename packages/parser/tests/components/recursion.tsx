interface TreeNode {
  name: string;
  children?: TreeNode[];
}

const TREE: TreeNode = {
  name: "root",
  children: [
    { name: "a", children: [{ name: "a1" }, { name: "a2", children: [{ name: "a2x" }] }] },
    { name: "b" },
  ],
};

const Tree = ({ node, depth = 0 }: { node: TreeNode; depth?: number }) => (
  <li data-depth={depth}>
    <span>{node.name}</span>
    {node.children && node.children.length > 0 ? (
      <ul>
        {node.children.map((child) => (
          <Tree key={child.name} node={child} depth={depth + 1} />
        ))}
      </ul>
    ) : null}
  </li>
);

const Countdown = ({ from }: { from: number }): React.ReactNode =>
  from <= 0 ? (
    <b>liftoff</b>
  ) : (
    <span>
      {from}
      <Countdown from={from - 1} />
    </span>
  );

const Mutual = ({ level }: { level: number }) => (level > 2 ? <i>end</i> : <Other level={level} />);
const Other = ({ level }: { level: number }) => (
  <div>
    <Mutual level={level + 1} />
  </div>
);

interface SelfReplacingSelector {
  (state: { label: string }): { label: string };
  select: (state: { label: string }) => { label: string };
}

// react-redux's `mapToPropsProxy`: swaps its own `select` property, then recurses with the same arguments.
const createSelector = (select: (state: { label: string }) => { label: string }) => {
  const proxy: SelfReplacingSelector = (state) => proxy.select(state);
  proxy.select = (state) => {
    proxy.select = select;
    return proxy(state);
  };
  return proxy;
};

const selectLabel = createSelector((state) => ({ label: state.label.toUpperCase() }));

const Selected = () =>
  selectLabel({ label: "store" }).label === "STORE" ? <output>upper</output> : <i>lower</i>;

export default function Recursion() {
  return (
    <section>
      <ul>
        <Tree node={TREE} />
      </ul>
      <Countdown from={3} />
      <Mutual level={0} />
      <Selected />
    </section>
  );
}
