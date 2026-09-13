const outcome: Record<string, string> = {};

const record = (key: string) => (value: unknown) => {
  outcome[key] = String(value);
};

Promise.resolve("fulfilled").then(record("then"));
Promise.reject(new Error("boom")).catch((error: Error) => record("catch")(error.message));
Promise.resolve(1)
  .then((count) => count + 1)
  .then((count) => count * 10)
  .then(record("chain"));
Promise.resolve(Promise.resolve("adopted")).then(record("adopt"));
new Promise<string>((resolve) => resolve("executor")).then(record("executor"));
new Promise<string>((_resolve, reject) => reject(new Error("rejected")))
  .then(() => "unreachable")
  .catch((error: Error) => error.message)
  .then(record("rejectedExecutor"));
Promise.all([Promise.resolve("x"), "y", Promise.resolve(3)]).then((items) =>
  record("all")(items.join("+")),
);
Promise.resolve("kept")
  .finally(() => record("finally")("ran"))
  .then(record("afterFinally"));
new Promise(() => {}).then(record("never"));

const shout = async (value: string) => {
  const inner = await Promise.resolve(value);
  return inner.toUpperCase();
};
shout("shout").then(record("async"));

const failing = async () => {
  throw new Error("async failure");
};
failing().catch((error: Error) => record("asyncCatch")(error.message));

const plain = async () => "no await";
plain().then(record("plainAsync"));

const settled = Promise.resolve("identity");
const identityCache = new Map<Promise<string>, string>([[settled, "cached"]]);
const isSamePromise = Promise.resolve(settled) === settled;
const cached = identityCache.get(settled) ?? "missing";

const describe = (value: unknown): string => {
  if (value === null || value === undefined) return "nullish";
  return typeof (value as { then?: unknown }).then === "function" ? "thenable" : "plain";
};

const SETTLED_KEYS = [
  "then",
  "catch",
  "chain",
  "adopt",
  "executor",
  "rejectedExecutor",
  "all",
  "finally",
  "afterFinally",
  "async",
  "asyncCatch",
  "plainAsync",
];

export default function Promises() {
  return (
    <dl>
      {SETTLED_KEYS.map((key) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{outcome[key] ?? "pending"}.</dd>
        </div>
      ))}
      <dt>never</dt>
      <dd>{outcome.never ?? "pending"}.</dd>
      <dt>identity</dt>
      <dd>{isSamePromise ? cached : "different"}.</dd>
      <dd>{settled instanceof Promise && !({} instanceof Promise) ? "instance" : "other"}.</dd>
      <dt>receivers</dt>
      <dd>{[describe(settled), describe(undefined), describe(null), describe({})].join(",")}.</dd>
    </dl>
  );
}
