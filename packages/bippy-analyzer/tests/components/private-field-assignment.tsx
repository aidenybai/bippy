interface RegistryConfig {
  entries?: Map<string, number>;
  label?: string;
}

class Registry {
  #entries;
  #label;
  #settings = { limit: 2 };

  constructor(config: RegistryConfig = {}) {
    this.#entries = config.entries || new Map<string, number>();
    this.#label = config.label ?? "default";
    this.#settings.limit = 3;
  }

  register(key: string, value: number) {
    this.#entries.set(key, value);
    return this;
  }

  get label() {
    return this.#label;
  }

  getEntries() {
    return this.#entries;
  }

  getLimit() {
    return this.#settings.limit;
  }
}

const registry = new Registry().register("alpha", 1).register("beta", 2);
const named = new Registry({ label: "named" });

export default function PrivateFieldAssignment() {
  return (
    <ul data-label={registry.label} data-named={named.label}>
      {[...registry.getEntries().entries()].map(([key, value]) => (
        <li key={key}>
          {key}={value}
        </li>
      ))}
      <li>limit={registry.getLimit()}</li>
    </ul>
  );
}
