const SLOTS = [1, 2, 3, 4, 5, 6];

const Gauge = ({ slot }: { slot: number }) => {
  const isVisible = Math.random() > 0.5;
  const isHighlighted = Math.random() > 0.5;
  return <li>{isVisible && (isHighlighted ? <b>{slot}</b> : null)}</li>;
};

export const isPartial = true;
export const isEnumerated = true;

export default function EmptyAlternatives() {
  return (
    <ul>
      {SLOTS.map((slot) => (
        <Gauge key={slot} slot={slot} />
      ))}
    </ul>
  );
}
