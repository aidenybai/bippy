interface Span {
  name: string;
  duration: number;
}

/** `forEach` on a collection the analysis cannot enumerate runs its callback any number of times: what it assigns is decided at runtime. */
const findSlowest = (entries: PerformanceEntryList): Span | null => {
  let slowest: Span | null = null;
  let total = 0;
  entries.forEach((entry, index) => {
    total += entry.duration;
    if (slowest === null || entry.duration > slowest.duration) {
      slowest = { name: `${entry.name}#${index}`, duration: entry.duration };
    }
  });
  return slowest && { ...slowest, duration: total };
};

export default function OpaqueForEachCallbacks() {
  const slowest = findSlowest(performance.getEntriesByType("resource"));
  return (
    <section>{slowest === null ? <em>no resources</em> : <strong>{slowest.name}</strong>}</section>
  );
}

export const isPartial = true;
