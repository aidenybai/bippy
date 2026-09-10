// A listener that may fire before the capture writes some keys of an object the
// render reads: only those keys become unknown, the others stay exact. A
// computed write (`store[key] = ...`) can touch anything, so the whole object
// does.
const session = { theme: "dark", messages: 0, isLive: false };
const registry: Record<string, number> = { hits: 0 };

window.addEventListener("message", (event: MessageEvent) => {
  session.messages++;
  session.isLive = true;
  registry[String(event.origin)] = 1;
});

const Inbox = () => (
  <section>
    {session.theme === "dark" ? <b>dark</b> : <i>light</i>}
    {session.messages > 0 ? <em>messages</em> : null}
    {registry.hits > 0 ? <u>hit</u> : null}
  </section>
);

const Storage = () => {
  const box = { current: "idle", label: "box" };
  window.addEventListener("storage", () => {
    box.current = "synced";
  });
  return (
    <output title={box.label}>
      {box.current === "idle" ? <span>idle</span> : <strong>synced</strong>}
    </output>
  );
};

export default function EscapedMutationKeys() {
  return (
    <div>
      <Inbox />
      <Storage />
    </div>
  );
}

export const minCoverage = 0.7;
