class Ring<T> {
  private readonly slots: Array<[string, T]> = [];

  set(key: string, value: T): this {
    const index = this.slots.findIndex((slot) => slot[0] === key);
    if (index === -1) this.slots.push([key, value]);
    else this.slots[index] = [key, value];
    return this;
  }

  entries(): RingIterator<T> {
    return new RingIterator(this.slots);
  }

  [Symbol.iterator](): RingIterator<T> {
    return this.entries();
  }
}

class RingIterator<T> implements IterableIterator<[string, T]> {
  private position = 0;

  constructor(private readonly slots: Array<[string, T]>) {}

  next(): IteratorResult<[string, T]> {
    if (this.position >= this.slots.length) return { value: undefined, done: true };
    return { value: this.slots[this.position++], done: false };
  }

  [Symbol.iterator](): this {
    return this;
  }
}

const countdown = {
  from: 3,
  [Symbol.iterator]() {
    let current = this.from;
    return {
      next: () => (current > 0 ? { value: current--, done: false } : { value: 0, done: true }),
    };
  },
};

const ring = new Ring<number>().set("a", 1).set("b", 2).set("a", 3);
const keys = new Set(Array.from(ring, ([key]) => key));
const [firstEntry, ...restEntries] = ring;
const copied = new Map(ring);

export default function IterationProtocol() {
  const rows: string[] = [];
  for (const [key, value] of ring) rows.push(`${key}=${value}`);
  return (
    <ul>
      <li>{rows.join(",")}</li>
      <li>{[...countdown].join(">")}</li>
      <li>{Math.max(...countdown)}</li>
      <li>{[...keys].join("|")}</li>
      <li>{`${firstEntry[0]}:${restEntries.length}`}</li>
      <li>{Object.fromEntries(copied).b}</li>
    </ul>
  );
}
