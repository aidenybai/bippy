"use client";

import { memo, useState } from "react";

// every component keeps a hook so getSource's stack-sampling (null
// dispatcher + sampled throw) can locate it; hook-less, prop-less
// components never throw and would resolve to null

// the inner component is named distinctly from the memo export: a shared
// name makes the transpiler rename the inner function (HmrMemoTarget2) to
// avoid the binding collision, which breaks display-name assertions
const HmrMemoInner = () => {
  useState(0);
  return <div data-testid="hmr-memo-target">memo-marker-a</div>;
};

export const HmrMemoTarget = memo(HmrMemoInner);

export const HmrListItem = ({ itemIndex }: { itemIndex: number }) => {
  useState(0);
  return <li data-testid={`hmr-list-item-${itemIndex}`}>list-marker-a:{itemIndex}</li>;
};

export const HmrStatefulTarget = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <button
      data-testid="hmr-stateful-target"
      onClick={() => setClickCount((previousCount) => previousCount + 1)}
      type="button"
    >
      stateful-marker-a:{clickCount}
    </button>
  );
};

// exported from the module but intentionally never rendered by the app:
// editing this file re-registers its family, so refresh updates report it
// in updatedComponents while updatedFibers stays empty for it
export const HmrUnmountedTarget = () => {
  useState(0);
  return <div data-testid="hmr-unmounted-target">unmounted-marker-a</div>;
};
