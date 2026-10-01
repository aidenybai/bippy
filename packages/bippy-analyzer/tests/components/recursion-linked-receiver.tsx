export const isExact = true;

class ListNode {
  value: string;
  next: ListNode | null;
  constructor(value: string, next: ListNode | null) {
    this.value = value;
    this.next = next;
  }
  walk(): string[] {
    const rest = this.next ? this.next.walk() : [];
    return [this.value, ...rest];
  }
  size(): number {
    return this.next ? 1 + this.next.size() : 1;
  }
  last(): ListNode {
    return this.next ? this.next.last() : this;
  }
}

class Counter {
  count: number;
  constructor(count: number) {
    this.count = count;
  }
  bumpTo(target: number): number {
    if (this.count >= target) return this.count;
    this.count += 1;
    return this.bumpTo(target);
  }
}

const chain = new ListNode("a", new ListNode("b", new ListNode("c", new ListNode("d", null))));

export default function RecursionLinkedReceiver() {
  const counter = new Counter(0);
  const bumped = counter.bumpTo(3);
  return (
    <section>
      <ol>
        {chain.walk().map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ol>
      <output>{chain.size()}</output>
      <b>{chain.last().value}</b>
      <i>{bumped}</i>
    </section>
  );
}
