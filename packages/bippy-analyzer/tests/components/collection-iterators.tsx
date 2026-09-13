class LruCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  keys(): K[] {
    return [...this.cache.keys()];
  }
}

const lru = new LruCache<string, number>(2);
lru.set("a", 1);
lru.set("b", 2);
lru.get("a");
lru.set("c", 3);

const scores = new Map<string, number>([
  ["x", 1],
  ["y", 2],
  ["z", 3],
]);
const entryIterator = scores.entries();
const firstEntry = entryIterator.next();
const restEntries = [...entryIterator];
const valuesIterator = scores.values();
const summed: number[] = [];
for (const value of valuesIterator) summed.push(value * 10);
const exhausted = valuesIterator.next();

const tags = new Set(["one", "two", "one", "three"]);
const tagIterator = tags.values();
tagIterator.next();
const remainingTags = Array.from(tagIterator);
const setEntries = [...tags.entries()].map(([key, value]) => `${key}=${value}`);

const wide: Record<string, number> = Object.fromEntries(
  Array.from({ length: 300 }, (_, index) => [`k${index}`, index]),
);
let keyTotal = 0;
for (const key in wide) keyTotal += wide[key];
let valueTotal = 0;
for (const value of Object.values(wide)) valueTotal += value;
const wideMap = new Map(Object.entries(wide));
let mapTotal = 0;
for (const [, value] of wideMap) mapTotal += value;

export default function CollectionIterators() {
  return (
    <ul>
      <li>lru: {lru.keys().join(",")}</li>
      <li>
        first: {String(firstEntry.value?.[0])}:{String(firstEntry.done)}
      </li>
      <li>rest: {restEntries.map(([key, value]) => `${key}${value}`).join(",")}</li>
      <li>summed: {summed.join(",")}</li>
      <li>
        exhausted: {String(exhausted.value)}:{String(exhausted.done)}
      </li>
      <li>tags: {remainingTags.join(",")}</li>
      <li>setEntries: {setEntries.join(",")}</li>
      <li>
        wide: {keyTotal} {valueTotal} {mapTotal}
      </li>
    </ul>
  );
}
