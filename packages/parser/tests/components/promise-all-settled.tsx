const outcome: Record<string, string> = {};

const record = (key: string) => (value: unknown) => {
  outcome[key] = String(value);
};

const describeSettled = (result: PromiseSettledResult<unknown>): string =>
  result.status === "fulfilled"
    ? `ok:${String(result.value)}`
    : `err:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;

Promise.allSettled([
  Promise.resolve("first"),
  Promise.reject(new Error("second")),
  "third",
  new Promise<number>((resolve) => resolve(4)),
]).then((results) => record("mixed")(results.map(describeSettled).join("|")));

Promise.allSettled([]).then((results) => record("empty")(results.length));

const loadAll = async () => {
  const results = await Promise.allSettled([
    (async () => {
      await Promise.resolve();
      throw new Error("late");
    })(),
    (async () => (await Promise.resolve("early")).toUpperCase())(),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  try {
    for (const failure of failures) {
      if (failure instanceof Error) throw failure;
    }
    return "no failures";
  } catch (error) {
    return `caught ${error instanceof Error ? error.message : "unknown"}`;
  }
};
loadAll().then(record("loadAll"));

Promise.allSettled([Promise.reject(new Error("only"))])
  .then(() => "fulfilled")
  .catch(() => "rejected")
  .then(record("neverRejects"));

const SETTLED_KEYS = ["mixed", "empty", "loadAll", "neverRejects"];

export const isExact = true;

export default function PromiseAllSettled() {
  return (
    <dl>
      {SETTLED_KEYS.map((key) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{outcome[key] ?? "pending"}.</dd>
        </div>
      ))}
    </dl>
  );
}
