import { Children, isValidElement, type ReactNode } from "react";

// `isValidElement(child)` / `Array.isArray(value)` on a value the source leaves
// undecided (react-router's `createRoutesFromChildren` over `{flag && <Route />}`
// children) narrow the tested binding on each side, so the element side reads
// props off an element and the other side never reaches them.

interface ItemProps {
  label: string;
  children?: ReactNode;
}

interface Entry {
  id: string;
  label: string;
  children: Entry[];
}

const Item = (_props: ItemProps) => null;

const collectEntries = (children: ReactNode, parentPath: number[] = []): Entry[] => {
  const entries: Entry[] = [];
  Children.forEach(children, (child, index) => {
    if (!isValidElement<ItemProps>(child)) return;
    const path = [...parentPath, index];
    entries.push({
      id: path.join("-"),
      label: child.props.label,
      children: child.props.children ? collectEntries(child.props.children, path) : [],
    });
  });
  return entries;
};

const Outline = ({ entries }: { entries: Entry[] }) => (
  <ul>
    {entries.map((entry) => (
      <li key={entry.id}>
        {entry.label}
        {entry.children.length > 0 ? <Outline entries={entry.children} /> : null}
      </li>
    ))}
  </ul>
);

const Tree = ({ children }: { children?: ReactNode }) => (
  <Outline entries={collectEntries(children)} />
);

const Labels = ({ value }: { value: string | string[] }) =>
  Array.isArray(value) ? (
    <>
      {value.map((label) => (
        <b key={label}>{label}</b>
      ))}
    </>
  ) : (
    <i>{value}</i>
  );

export default function TypeGuardNarrowing() {
  const hasExtra = window.location.hash === "#extra";
  return (
    <div>
      <Tree>
        <Item label="home">
          <Item label="index" />
          {hasExtra && <Item label="extra" />}
        </Item>
        {hasExtra && <Item label="settings" />}
        <Item label="about" />
      </Tree>
      <Labels value={hasExtra ? ["one", "two"] : "single"} />
    </div>
  );
}
