interface Probe {
  label: string;
}

const PROBES: Probe[] = [{ label: "alpha" }, { label: "beta" }];

/** The observer callback escapes: what it pushes, reorders and reassigns is decided by code the analysis never runs. */
const observeProbes = (): { changed: string[]; latest: string | null; ordered: Probe[] } => {
  const changed: string[] = ["initial"];
  const ordered = [...PROBES];
  let latest: string | null = null;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      changed.push(record.type);
      latest = record.type;
    }
    ordered.reverse();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { changed, latest, ordered };
};

let mutationCount = 0;
const counter = new MutationObserver((records) => {
  mutationCount += records.length;
});
counter.observe(document.body, { childList: true });

export default function EscapedCapturedVariables() {
  const { changed, latest, ordered } = observeProbes();
  return (
    <main>
      <ul>
        {changed.map((type, index) => (
          <li key={index}>{type}</li>
        ))}
      </ul>
      {latest === null ? <em>idle</em> : <strong>{latest}</strong>}
      <ol>
        {ordered.map((probe) => (
          <li key={probe.label}>{probe.label}</li>
        ))}
      </ol>
      {mutationCount === 0 ? <i>no mutations</i> : <b>{mutationCount}</b>}
    </main>
  );
}

export const isPartial = true;
