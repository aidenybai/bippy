const formatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" });

/** The wall clock decides how many parts come back; the static side only knows it gets an array. */
const parts = formatter.formatToParts(new Date());

const PartRow = ({ type }: { type: string }) => (
  <li>
    <code>{type}</code>
  </li>
);

const FormattedParts = () => {
  const rows = Array.from(parts, (part) => <PartRow key={part.type} type={part.type} />);
  const types = Array.from(parts).map((part) => part.type);
  const sorted = Array.from(parts)
    .slice()
    .sort((left, right) => left.type.localeCompare(right.type));
  return (
    <section>
      <ul>{rows}</ul>
      <p>{types.join("/")}</p>
      <ol>
        {sorted.map((part) => (
          <li key={part.type}>{part.type}</li>
        ))}
      </ol>
    </section>
  );
};

export const isPartial = true;

export default function ArrayFromDynamic() {
  return <FormattedParts />;
}
