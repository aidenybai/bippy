import { CycleA } from "./cycle-a";

export const CycleB = ({ depth }: { depth: number }) => (
  <blockquote>
    <CycleA depth={depth} />
  </blockquote>
);
