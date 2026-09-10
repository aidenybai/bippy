/**
 * A module-level counter bumped during render. The two alternatives are
 * mutually exclusive, so whichever renders sees the count start at zero; a
 * single materialization that renders both would let the first alternative's
 * increment leak into the second.
 */
let renderCount = 0;

const Counted = ({ label }: { label: string }) => {
  renderCount += 1;
  return (
    <span>
      {label}:{renderCount}
    </span>
  );
};

const Painter = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  return context ? <Counted label="canvas" /> : <Counted label="fallback" />;
};

export default function RenderCounterInterference() {
  return (
    <main>
      <Painter />
    </main>
  );
}

export const isPartial = true;
export const isReplayCorrected = true;
