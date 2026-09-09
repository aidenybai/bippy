class Money {
  constructor(
    private readonly cents: number,
    private readonly currency: string,
  ) {}

  valueOf(): number {
    return this.cents;
  }

  toString(): string {
    return `${this.currency} ${(this.cents / 100).toFixed(2)}`;
  }
}

const price = new Money(1250, "USD");
const tax = new Money(250, "USD");

const label = { toString: () => "labelled" };
const numeric = { valueOf: () => 40 };
const inert = { name: "inert" };

const summary = [
  `template:${price}`,
  `string:${String(price)}`,
  `plus:${price + tax}`,
  `concat:${"total " + price}`,
  `label:${label} ${"x" + label}`,
  `numeric:${numeric + 2} ${`${numeric}`}`,
  `inert:${String(inert)}`,
];

export const isExact = true;

export default function UserDefinedToPrimitive() {
  return (
    <ul>
      {summary.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
