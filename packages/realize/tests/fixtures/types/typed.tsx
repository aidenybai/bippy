// @ts-nocheck
interface Item {
  id: string;
}

interface TypedProps {
  label: string;
  count: number;
  mode: "list" | "grid";
  isActive: boolean;
  list: string[];
  pair: [number, string];
  frozenList: readonly string[];
  frozenMap: ReadonlyMap<string, number>;
  frozenSet: ReadonlySet<string>;
  lookup: Map<string, number>;
  tags: Set<string>;
  loose: any;
  opaque: unknown;
  maybeList: string[] | null;
  maybeLabel: string | undefined;
  either: string[] | Map<string, number>;
  format: (value: number) => string;
  consume: (item: Item) => void;
  measure: (items: readonly string[]) => number;
  makeList: () => string[];
  freeze: () => readonly string[];
  overloaded: { (value: string): string; (value: number): number };
  fixedPair: readonly [number, string];
  frozenItems: readonly Item[];
  pick: (items: Item[]) => Item;
  onClose?: () => void;
}

export const Typed = ({
  label,
  count,
  mode,
  isActive,
  list,
  pair,
  frozenList,
  frozenMap,
  frozenSet,
  lookup,
  tags,
  loose,
  opaque,
  maybeList,
  maybeLabel,
  either,
  format,
  consume,
  measure,
  makeList,
  freeze,
  overloaded,
  fixedPair,
  frozenItems,
  pick,
  onClose,
}: TypedProps) => (
  <div
    values={[
      label,
      count,
      mode,
      isActive,
      list,
      pair,
      frozenList,
      frozenMap,
      frozenSet,
      lookup,
      tags,
      loose,
      opaque,
      maybeList,
      maybeLabel,
      either,
      format,
      consume,
      measure,
      makeList,
      freeze,
      overloaded,
      fixedPair,
      frozenItems,
      pick,
      onClose,
    ]}
  />
);
