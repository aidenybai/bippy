import { memo, useState } from "react";

interface TreeNode {
  name: string;
  parent: TreeNode | null;
  meta: Record<string, string>;
}

const root: TreeNode = { name: "root", parent: null, meta: { depth: "0" } };
root.parent = root;
const child: TreeNode = { ...root, name: "child", parent: root };
const grandchild = {
  ...child,
  name: "grandchild",
  parent: child,
  meta: { ...child.meta, depth: "2" },
};

const lineage = [grandchild.name, grandchild.parent?.name, grandchild.parent?.parent?.name].join(
  ">",
);
const cyclic = root.parent.parent.parent.name;

const defaults = { size: "md", tone: "neutral", icon: undefined as string | undefined };
const overrides = { tone: "danger", icon: undefined };
const merged = { ...defaults, ...overrides, tone: "warning" };
const hasIcon = "icon" in merged;
const iconType = typeof merged.icon;

const pairs: Array<[string, string]> = [
  ["a", "1"],
  ["b", "2"],
  ["a", "3"],
];
const fromPairs = Object.fromEntries(pairs);
const fromMap = Object.fromEntries(
  new Map([
    ["x", 1],
    ["y", 2],
  ]),
);
const fromEntries = Object.fromEntries(Object.entries({ p: true, q: false }));
const fromOptional = Object.fromEntries(
  pairs.map(([key, value]) => [key, Number(value) > 1 ? value : undefined]),
);

const Badge = ({ label }: { label: string }) => <i>{label}</i>;
const NamedBadge = Object.assign(Badge, { displayName: "Assigned", variant: "solid" });
const BadgeGroup = Object.assign(
  ({ children }: { children: React.ReactNode }) => <span className="group">{children}</span>,
  { Item: Badge, displayName: "BadgeGroup" },
);
const MemoBadge = memo(NamedBadge);

const shared = { id: 1 };
const isSameShared = Object.is(shared, shared);
const isDistinct = Object.is({ id: 1 }, { id: 1 });
const isNegativeZero = Object.is(-0, 0);
const isNaNEqual = Object.is(Number.NaN, Number.NaN);

const SELECTION = /^(?!#).*(query|subscription|mutation)\s+([a-zA-Z0-9_]+)/m;

const IdentityState = () => {
  const [selected, setSelected] = useState(shared);
  const [query, setQuery] = useState("# comment\nquery Hello { world }");
  const isCurrent = Object.is(selected, shared);
  const operation = SELECTION.exec(query)?.[2] ?? null;
  const isQuery = SELECTION.test(query);
  return (
    <button
      type="button"
      data-current={isCurrent}
      data-query={isQuery}
      onClick={() => {
        setSelected({ id: 2 });
        setQuery("mutation Save { ok }");
      }}
    >
      {operation ?? "anonymous"}
    </button>
  );
};

export default function ObjectSemantics() {
  return (
    <section>
      <h1>{lineage}</h1>
      <h2>{cyclic}</h2>
      <p>
        {merged.size}/{merged.tone}/{hasIcon ? "has-icon" : "no-icon"}/{iconType}
      </p>
      <p>
        {fromPairs.a},{fromPairs.b},{fromMap.x + fromMap.y},{String(fromEntries.p)},
        {String(fromEntries.q)},{fromOptional.a ?? "none"},{fromOptional.b ?? "none"}
      </p>
      <p>{[isSameShared, isDistinct, isNegativeZero, isNaNEqual].join(",")}</p>
      <NamedBadge label={`${NamedBadge.displayName}:${NamedBadge.variant}`} />
      <BadgeGroup>
        <BadgeGroup.Item label={BadgeGroup.displayName ?? "anonymous"} />
      </BadgeGroup>
      <MemoBadge label="memo" />
      <IdentityState />
    </section>
  );
}
