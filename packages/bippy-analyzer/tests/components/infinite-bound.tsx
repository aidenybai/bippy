export const isPartial = true;

export default function InfiniteBound() {
  const score = 100 / Math.random();
  const limit = Number.POSITIVE_INFINITY;
  return (
    <main>
      {score >= limit ? <b>unbounded</b> : <i>bounded</i>}
      {score < 50 ? <u>low</u> : <s>high</s>}
    </main>
  );
}
