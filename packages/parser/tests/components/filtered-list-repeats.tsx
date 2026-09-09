/** A filtered list may hold fewer items than its source: the two `map`s decide separate counts. */
export const isPartial = true;

export default function FilteredListRepeats() {
  const entries = document.cookie.split("; ");
  const flagged = entries.filter((entry) => entry.startsWith("flag="));
  return (
    <div>
      {entries.map((entry) => (
        <b key={entry}>{entry}</b>
      ))}
      {flagged.map((entry) => (
        <i key={entry}>{entry}</i>
      ))}
    </div>
  );
}
