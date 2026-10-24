export const appendToGroup = <Key, Value>(
  groups: Map<Key, Value[]>,
  key: Key,
  value: Value,
): void => {
  const group = groups.get(key);
  if (group) {
    group.push(value);
    return;
  }
  groups.set(key, [value]);
};
