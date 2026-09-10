const MAX_DELAY = Number.POSITIVE_INFINITY;

const Countdown = ({ width }: { width: number }) =>
  width < MAX_DELAY ? <p data-state="running">running</p> : <p data-state="expired">expired</p>;

const Badge = ({ width }: { width: number }) =>
  width === -Infinity ? <em>never</em> : <em>{width > -Infinity}</em>;

export const isPartial = true;

export default function InfiniteComparisonGuard() {
  const width = window.innerWidth;
  return (
    <section>
      <Countdown width={width} />
      <Badge width={width} />
    </section>
  );
}
