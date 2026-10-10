/**
 * Crash: `RangeError: Invalid string length` from serializeProjectAnalysis
 * (src/core/entrypoint/analyze-project.ts:127), which aborts `analyze --json`
 * and the conformance run for the whole repo (sonner).
 *
 * The symbolic render tree is a DAG: a JSX value referenced twice is one shared
 * object. JSON.stringify expands every reference, so the output doubles per
 * level. sonner's Toast (src/index.tsx:64) has the same shape through repeated
 * icon/close-button subtrees under nested conditionals: its `analysis.render`
 * alone serializes to ~437 MB and `report.states` (4375+, truncated) overflows
 * V8's maximum string length.
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
