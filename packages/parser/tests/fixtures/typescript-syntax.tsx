import type { ReactNode } from "react";

enum Status {
  Active = "active",
  Paused = "paused",
  Done = 2,
}

const enum Size {
  Small = 1,
  Large = Small * 4,
}

namespace Labels {
  export const title = "Labels";
  export const forStatus = (status: Status): string => `status:${String(status)}`;
}

const THEME = {
  primary: "teal",
  sizes: [Size.Small, Size.Large],
} as const satisfies { primary: string; sizes: readonly number[] };

interface Item {
  id: number;
  label?: string;
  meta?: { tags?: string[] };
}

const items: Item[] = [{ id: 1, label: "first", meta: { tags: ["x"] } }, { id: 2 }];

const abstractClassLike = <Value,>(value: Value): Value => value;

const Chip = ({ status }: { status: Status }) => (
  <span className={String(status)}>{Labels.forStatus(status)}</span>
);

const Optional = ({ item }: { item: Item }) => (
  <li>
    {item.label ?? "untitled"}
    {item.meta?.tags?.length ? <small>{item.meta.tags.join(",")}</small> : null}
    {(item.label ?? "")!.length > 3 && <b>long</b>}
  </li>
);

const Generic = <Value extends ReactNode>({ value }: { value: Value }) => (
  <code>{abstractClassLike(value)}</code>
);

export default function TypescriptSyntax() {
  const definitelyString = "sure" as string;
  return (
    <div style={{ color: THEME.primary }}>
      <h2>{Labels.title}</h2>
      <Chip status={Status.Active} />
      <Chip status={Status.Paused} />
      <p>{Status.Done}</p>
      <ul>
        {items.map((item) => (
          <Optional key={item.id} item={item} />
        ))}
      </ul>
      <Generic value={THEME.sizes[1]} />
      <Generic value={definitelyString satisfies string} />
      <p>{(THEME.sizes as readonly number[]).length}</p>
    </div>
  );
}
