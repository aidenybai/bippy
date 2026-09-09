import { useEffect, useState } from "react";

const preferences = { epoch: 1, color: "light" };

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("prefs") : null;

channel?.addEventListener("message", (event: MessageEvent<{ color?: string }>) => {
  preferences.epoch += 1;
  preferences.color = event.data.color ?? preferences.color;
});

const StoredPreferences = () => (
  <output data-epoch={preferences.epoch}>
    {preferences.epoch === 1 ? <b>fresh</b> : <i>synced</i>}
    {preferences.color === "light" ? <em>light</em> : <strong>{preferences.color}</strong>}
  </output>
);

interface Counter {
  n: number;
}

const EXPECTED_RECEIVED = "first:2:message:true,handler:1,handler:3";

const Peers = () => {
  const [sync, setSync] = useState("pending");
  const [received, setReceived] = useState<string[]>([]);
  useEffect(() => {
    const push = (entry: string) => setReceived((previous) => [...previous, entry]);
    const first = new BroadcastChannel("pair");
    const second = new BroadcastChannel("pair");
    const other = new BroadcastChannel("other");
    const onSecond = (event: MessageEvent<Counter>) => push(`second:${event.data.n}`);
    second.onmessage = (event: MessageEvent<Counter>) => push(`handler:${event.data.n}`);
    second.addEventListener("message", onSecond);
    second.addEventListener("message", onSecond);
    first.onmessage = (event: MessageEvent<Counter>) =>
      push(`first:${event.data.n}:${event.type}:${event.target === first}`);
    other.addEventListener("message", (event: MessageEvent<Counter>) =>
      push(`other:${event.data.n}`),
    );
    first.postMessage({ n: 1 });
    second.postMessage({ n: 2 });
    second.removeEventListener("message", onSecond);
    first.postMessage({ n: 3 });
    other.close();
    let thrown = "none";
    try {
      other.postMessage({ n: 4 });
    } catch (error) {
      thrown = error instanceof Error ? error.name : "other";
    }
    setSync(`${first.name}|${thrown}|${String(second.onmessage !== null)}`);
    return () => {
      first.close();
      second.close();
    };
  }, []);
  const delivered = [...received].sort().join(",");
  return (
    <dl>
      <dd>{sync === "pair|InvalidStateError|true" ? <b>synced</b> : <i>{sync}</i>}</dd>
      <dd>{delivered === EXPECTED_RECEIVED ? <b>delivered</b> : <i>{delivered}</i>}</dd>
    </dl>
  );
};

export const isExact = true;

export default function BroadcastChannels() {
  return (
    <main>
      <StoredPreferences />
      <Peers />
    </main>
  );
}
