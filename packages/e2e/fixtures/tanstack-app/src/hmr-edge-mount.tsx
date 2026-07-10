import { HmrListItem, HmrMemoTarget, HmrStatefulTarget } from "./hmr-edge-targets";
import { HmrStaleTarget } from "./hmr-stale-target";

const LIST_ITEM_INDEXES = [0, 1, 2];

// HmrUnmountedTarget is deliberately absent: the unmounted-component spec
// asserts its family is reported without any collected fibers
export const HmrEdgeTargets = () => {
  return (
    <>
      <HmrMemoTarget />
      <ul>
        {LIST_ITEM_INDEXES.map((itemIndex) => (
          <HmrListItem itemIndex={itemIndex} key={itemIndex} />
        ))}
      </ul>
      <HmrStatefulTarget />
      <HmrStaleTarget />
    </>
  );
};
