class Registry {
  entries: Map<string, number>;

  constructor() {
    this.entries = new Map([["alpha", 1]]);
  }

  lookup(name: string): number | undefined {
    return this.entries.get(name);
  }

  size(): number {
    return this.entries.size;
  }

  toState() {
    return { lookup: this.lookup.bind(this), size: this.size.bind(this) };
  }
}

const registry = new Registry();
const state = registry.toState();
const detached = registry.lookup;
const rebound = detached.bind(registry, "alpha");
const doublyBound = rebound.bind({ entries: new Map() });

const scale = function (this: { factor: number }, value: number) {
  return this.factor * value;
};
const scaled = [1, 2, 3].map(scale.bind({ factor: 10 }));
const arrow = () => registry.size();
const arrowBound = arrow.bind({ size: () => -1 });

export default function BoundFunctions() {
  return (
    <ul>
      <li>
        {state.lookup("alpha")} <em>ok</em>
      </li>
      <li>
        {String(state.lookup("beta"))} <em>ok</em>
      </li>
      <li>
        {state.size()} <em>ok</em>
      </li>
      <li>
        {rebound()} <em>ok</em>
      </li>
      <li>
        {doublyBound()} <em>ok</em>
      </li>
      <li>
        {scaled.join(",")} <em>ok</em>
      </li>
      <li>
        {arrowBound()} <em>ok</em>
      </li>
    </ul>
  );
}
