import { CycleB } from "./cycle-b";

export const CycleA = ({ depth }: { depth: number }) =>
  depth > 0 ? <CycleB depth={depth - 1} /> : <q>bottom</q>;
