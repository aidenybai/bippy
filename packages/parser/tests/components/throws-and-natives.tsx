interface Config {
  label?: string;
  tags?: { list: string[] } | null;
}

const parseId = (raw: string): number => {
  const numericId = parseInt(raw, 10);
  if (Number.isNaN(numericId)) throw new Error(`invalid id: ${raw}`);
  return numericId;
};

const safeParseId = (raw: string): string => {
  try {
    return `id ${parseId(raw)}`;
  } catch (error) {
    return error instanceof Error ? `caught ${error.message}` : "caught";
  }
};

const withFinally = (): string => {
  const steps: string[] = [];
  try {
    steps.push("try");
    throw new Error("stop");
  } catch {
    steps.push("catch");
  } finally {
    steps.push("finally");
  }
  return steps.join(",");
};

const describeOptional = (config: Config, mode: "left" | "right"): string => {
  const lettered = config.tags?.list.join("|") ?? "none";
  const listed = mode === "left" ? config.tags : null;
  const count = listed?.list.length ?? 0;
  const upper = config.label?.toUpperCase() ?? "no label";
  return `${lettered} ${count} ${upper}`;
};

const cache = new WeakMap<object, string>();
const seen = new WeakSet<object>();
const keyObject = { id: 1 };
cache.set(keyObject, "cached");
seen.add(keyObject);

const describeInstances = (): string[] => {
  const values: unknown[] = [[], new Map(), new Set(), {}, /re/, new Date(0), "text", cache];
  return values.map((value) =>
    [
      value instanceof Array,
      value instanceof Map,
      value instanceof Set,
      value instanceof Object,
      value instanceof RegExp,
      value instanceof Date,
      value instanceof WeakMap,
    ]
      .map((flag) => (flag ? "1" : "0"))
      .join(""),
  );
};

const listProxyKeys = (): string => {
  const target = { alpha: 1, beta: 2 };
  const proxied = new Proxy(target, {
    get: (object, property) => (property === "beta" ? 20 : Reflect.get(object, property)),
  });
  const keys: string[] = [];
  for (const key in proxied) keys.push(`${key}=${proxied[key as keyof typeof target]}`);
  return keys.join(",");
};

const REGISTRY_KEY = Symbol.for("fixture.registry");

interface Registry {
  [REGISTRY_KEY]?: Map<string, string>;
}

const describeSymbolKeys = (): string => {
  const tagged: Registry & { visible: number } = { visible: 1 };
  const registry = (tagged[REGISTRY_KEY] ??= new Map());
  registry.set("entry", "stored");
  const shared = ((globalThis as Registry)[REGISTRY_KEY] ??= new Map());
  shared.set("global", "once");
  const again = (globalThis as Registry)[REGISTRY_KEY]!;
  return [
    Object.keys(tagged).join("+"),
    tagged[REGISTRY_KEY]?.get("entry"),
    again === shared ? "same" : "different",
    again.get("global"),
  ].join(",");
};

const Row = ({ text }: { text: string }) => (
  <li>
    {text}
    <span />
  </li>
);

export default function ThrowsAndNatives() {
  return (
    <ul>
      <Row text={safeParseId("42")} />
      <Row text={safeParseId("prof-42")} />
      <Row text={withFinally()} />
      <Row text={describeOptional({ label: "a", tags: { list: ["x", "y"] } }, "left")} />
      <Row text={describeOptional({ tags: null }, "right")} />
      <Row text={describeInstances().join(" ")} />
      <Row text={cache.get(keyObject)} />
      <Row text={seen.has(keyObject) ? "seen" : "unseen"} />
      <Row text={cache.has({}) ? "hit" : "miss"} />
      <Row text={listProxyKeys()} />
      <Row text={describeSymbolKeys()} />
    </ul>
  );
}
