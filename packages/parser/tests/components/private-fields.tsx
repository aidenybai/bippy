class Counter {
  #count = 0;
  #history: number[] = [];
  #state = { label: "idle", updates: 0 };
  static #instances = 0;

  constructor(start: number) {
    this.#count = start;
    Counter.#instances += 1;
  }

  increment(by: number): this {
    this.#count += by;
    this.#history.push(this.#count);
    this.#state.updates++;
    this.#state.label = this.#count > 10 ? "high" : "low";
    return this;
  }

  reset(): void {
    [this.#count, this.#history] = [0, []];
    ({ label: this.#state.label } = { label: "reset" });
  }

  get summary(): string {
    return `${this.#state.label}:${this.#count}:${this.#history.join(",")}:${this.#state.updates}`;
  }

  static get instances(): number {
    return Counter.#instances;
  }
}

const first = new Counter(3).increment(4).increment(5);
const second = new Counter(1).increment(1);
second.reset();

export const isExact = true;

export default function PrivateFields() {
  return (
    <ul>
      <li>first: {first.summary}</li>
      <li>second: {second.summary}</li>
      <li>instances: {Counter.instances}</li>
    </ul>
  );
}
