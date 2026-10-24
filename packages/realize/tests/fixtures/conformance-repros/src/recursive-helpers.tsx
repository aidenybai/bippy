interface Settings {
  [key: string]: string | Settings;
}

const isSettings = (value: string | Settings | undefined): value is Settings =>
  typeof value === "object";

export const MergedSettings = ({
  defaults,
  overrides,
}: {
  defaults: Settings;
  overrides: Settings;
}) => {
  function deepMerge(base: Settings, override: Settings): Settings {
    const merged: Settings = { ...base };
    for (const key of Object.keys(override)) {
      const baseValue = base[key];
      const overrideValue = override[key];
      merged[key] =
        isSettings(baseValue) && isSettings(overrideValue)
          ? deepMerge(baseValue, overrideValue)
          : overrideValue;
    }
    return merged;
  }
  const settings = deepMerge(defaults, overrides);
  return <pre>{settings.theme === "dark" ? "dark" : "light"}</pre>;
};

interface TreeNode {
  label: string;
  children: TreeNode[];
}

const renderNodes = (nodes: TreeNode[]): React.ReactNode =>
  nodes.map((node) => (
    <li key={node.label}>
      {node.label}
      {node.children.length > 0 ? <ul>{renderNodes(node.children)}</ul> : null}
    </li>
  ));

export const Outline = ({ nodes }: { nodes: TreeNode[] }) => <ul>{renderNodes(nodes)}</ul>;
