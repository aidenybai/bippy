interface Entry {
  name: string;
  isHidden?: boolean;
}

const ENTRIES: Entry[] = [{ name: "Alpha" }, { name: "Beta", isHidden: true }, { name: "Gamma" }];

/** A browser fact: empty at runtime, any string statically. */
const readQuery = (): string => window.location.hash.slice(1);

/** Narrowing `query` inside a callback must not outlive the callback's own paths. */
const Palette = () => {
  const query = readQuery();
  const matches = ENTRIES.filter((entry) => {
    if (!query) return !entry.isHidden;
    return entry.name.toLowerCase().includes(query.toLowerCase());
  });
  let hiddenCount = 0;
  ENTRIES.forEach((entry) => {
    if (!query) return;
    if (entry.isHidden) hiddenCount += 1;
  });
  return (
    <div>
      {query ? <b>searching</b> : <i>browsing</i>}
      {hiddenCount > 0 ? <em>{hiddenCount} hidden</em> : null}
      <ul>
        {matches.map((entry) => (
          <li key={entry.name}>{entry.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default function NarrowedClosureVariables() {
  return <Palette />;
}

export const isPartial = true;
