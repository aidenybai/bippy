/**
 * Render values share subtrees, so serializing or printing them must not expand each
 * reference, or sonner's Toast grows to gigabytes.
 */
export function SharedSubtreeBlowup({ flag }: { flag: boolean }) {
  const l0 = flag ? <b>on</b> : <i>off</i>;
  const l1 = (
    <span>
      {l0}
      {l0}
    </span>
  );
  const l2 = (
    <span>
      {l1}
      {l1}
    </span>
  );
  const l3 = (
    <span>
      {l2}
      {l2}
    </span>
  );
  const l4 = (
    <span>
      {l3}
      {l3}
    </span>
  );
  const l5 = (
    <span>
      {l4}
      {l4}
    </span>
  );
  const l6 = (
    <span>
      {l5}
      {l5}
    </span>
  );
  const l7 = (
    <span>
      {l6}
      {l6}
    </span>
  );
  const l8 = (
    <span>
      {l7}
      {l7}
    </span>
  );
  const l9 = (
    <span>
      {l8}
      {l8}
    </span>
  );
  const l10 = (
    <span>
      {l9}
      {l9}
    </span>
  );
  const l11 = (
    <span>
      {l10}
      {l10}
    </span>
  );
  const l12 = (
    <span>
      {l11}
      {l11}
    </span>
  );
  const l13 = (
    <span>
      {l12}
      {l12}
    </span>
  );
  const l14 = (
    <span>
      {l13}
      {l13}
    </span>
  );
  const l15 = (
    <span>
      {l14}
      {l14}
    </span>
  );
  const l16 = (
    <span>
      {l15}
      {l15}
    </span>
  );
  const l17 = (
    <span>
      {l16}
      {l16}
    </span>
  );
  const l18 = (
    <span>
      {l17}
      {l17}
    </span>
  );
  const l19 = (
    <span>
      {l18}
      {l18}
    </span>
  );
  return <div>{l19}</div>;
}
