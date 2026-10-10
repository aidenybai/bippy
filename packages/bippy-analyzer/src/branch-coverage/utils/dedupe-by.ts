/** Keep the first item per key, preserving order. */
export const dedupeBy = <Item>(items: Item[], keyOf: (item: Item) => string): Item[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
