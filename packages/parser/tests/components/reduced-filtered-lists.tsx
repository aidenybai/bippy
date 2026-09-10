interface MenuItem {
  name: string;
  weight: number;
  isAdvanced?: boolean;
}

const ITEMS: MenuItem[] = [
  { name: "separator", weight: 0 },
  { name: "bold", weight: 1 },
  { name: "separator", weight: 0 },
  { name: "separator", weight: 0 },
  { name: "table", weight: 2, isAdvanced: true },
  { name: "image", weight: 3 },
  { name: "separator", weight: 0 },
];

/** A browser fact: true at runtime, undecided statically. */
const hasWideViewport = (): boolean => window.location.hash !== "#compact";

const dropExcessSeparators = (items: MenuItem[]): MenuItem[] =>
  items.reduce<MenuItem[]>((kept, item) => {
    const previous = kept[kept.length - 1];
    if (item.name === "separator" && (!previous || previous.name === "separator")) return kept;
    kept.push(item);
    return kept;
  }, []);

const Toolbar = () => {
  const isWide = hasWideViewport();
  const visible = ITEMS.filter((item) => !item.isAdvanced || isWide);
  const items = dropExcessSeparators(visible);
  const total = visible.reduce((sum, item) => sum + item.weight, 0);
  const heaviest = visible.reduceRight((best, item) => (item.weight > best.weight ? item : best));
  return (
    <div>
      <ul>
        {items.map((item, index) =>
          item.name === "separator" ? <hr key={index} /> : <li key={item.name}>{item.name}</li>,
        )}
      </ul>
      {total > 5 ? <strong>heavy</strong> : <span>light</span>}
      <em>{heaviest.name}</em>
    </div>
  );
};

export default function ReducedFilteredLists() {
  return <Toolbar />;
}

export const isPartial = true;
