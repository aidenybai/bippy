import { useState } from "react";

// lives in its own module so the stale spec can rewrite its hook list
// (changing the react-refresh signature) without invalidating the other
// hmr fixtures' families
export const HmrStaleTarget = () => {
  useState(0);
  return <div data-testid="hmr-stale-target">stale-marker-a</div>;
};
