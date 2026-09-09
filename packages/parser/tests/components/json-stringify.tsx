class Money {
  constructor(
    private readonly amount: number,
    private readonly currency: string,
  ) {}

  toJSON(): string {
    return `${this.amount} ${this.currency}`;
  }
}

const order = {
  id: 7,
  total: new Money(12.5, "EUR"),
  placedAt: new Date(0),
  note: undefined,
  onShip: () => null,
  tag: Symbol("internal"),
  ratio: Number.NaN,
  distance: Number.POSITIVE_INFINITY,
  lines: [undefined, () => null, Symbol("gap"), null, "sku-1"],
  nested: { deep: { flag: true, missing: undefined } },
  quoted: 'say "hi"\n',
};

const dropNumbers = (_key: string, value: unknown): unknown =>
  typeof value === "number" ? undefined : value;

const serialized = [
  JSON.stringify(order),
  JSON.stringify(order, null, 2),
  JSON.stringify(order, ["id", "nested", "deep", "flag"]),
  JSON.stringify(order, dropNumbers),
  JSON.stringify(order, null, "--"),
  JSON.stringify([1, "two", [3, { four: 4 }]], null, "\t"),
  String(JSON.stringify(undefined)),
  String(JSON.stringify(() => null)),
  JSON.stringify(null),
  JSON.stringify("plain"),
  JSON.stringify({ toJSON: () => ({ replaced: true }) }),
  JSON.stringify({ when: new Date(86_400_000) }),
  JSON.stringify(new Map([["ignored", 1]])),
  JSON.stringify([new Set([1])]),
  JSON.stringify({ a: 1, b: [1, 2] }, null, 20),
];

export const isExact = true;

export default function JsonStringify() {
  return (
    <ol>
      {serialized.map((text, index) => (
        <li key={index}>
          {index}: <pre>{text}</pre>
          {text}
        </li>
      ))}
    </ol>
  );
}
