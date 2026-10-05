interface ViewportHost {
  label: string;
  width: number | null;
}

const host: ViewportHost = { label: "open", width: null };

/** The observer callback escapes and writes `host.width`; the members it does not write stay decided by the source. */
const observer = new MutationObserver(() => {
  host.width = window.innerWidth;
});
observer.observe(document.body, { childList: true });

const Overlay = () => (
  <section>{host.label === "open" ? <strong>open</strong> : <em>{host.label}</em>}</section>
);

export default function EscapedMemberWrites() {
  return (
    <main>
      <Overlay />
    </main>
  );
}
