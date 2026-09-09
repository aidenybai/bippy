/** One list read in several places: every `map` over it has the same number of items. */
export const isPartial = true;

export default function SharedListRepeats() {
  const entries = document.cookie.split("; ");
  return (
    <div>
      {entries.length > 1 && <hr />}
      {entries.map((entry) => entry.startsWith("a=") && <b key={entry}>A</b>)}
      {entries.map((entry) => entry.startsWith("b=") && <i key={entry}>B</i>)}
    </div>
  );
}
