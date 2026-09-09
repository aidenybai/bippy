/** Assigning `this.#field` inside methods writes the private slot the same way a field initializer does. */
class QueryCache {
  #entries;
  #mountCount;
  #stats;

  constructor() {
    this.#entries = new Map<string, string>();
    this.#mountCount = 0;
    this.#stats = { hits: 0 };
  }

  mount() {
    this.#mountCount++;
    this.#stats.hits += 2;
    return this.#mountCount;
  }

  set(key: string, value: string) {
    this.#entries.set(key, value);
  }

  size() {
    return this.#entries.size;
  }

  hits() {
    return this.#stats.hits;
  }
}

const cache = new QueryCache();
cache.set("todos", "3 items");
cache.mount();
const mounts = cache.mount();

export const isExact = true;

export default function PrivateFieldAssignment() {
  return (
    <section data-mounts={mounts}>
      <strong>{cache.size()} cached</strong>
      <em>{cache.hits()} hits</em>
      {mounts === 2 ? <p>mounted twice</p> : <p>mount count unknown</p>}
    </section>
  );
}
