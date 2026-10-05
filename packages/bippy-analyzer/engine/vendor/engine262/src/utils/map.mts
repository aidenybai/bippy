interface InsertableMap<Key, Item> {
  has: (key: Key) => boolean;
  get: (key: Key) => Item | undefined;
  set: (key: Key, value: Item) => unknown;
}

export const getOrInsertComputed = <Key, Item>(
  map: InsertableMap<Key, Item>,
  key: Key,
  createValue: () => Item,
): Item => {
  if (map.has(key)) return map.get(key)!;
  const value = createValue();
  map.set(key, value);
  return value;
};
