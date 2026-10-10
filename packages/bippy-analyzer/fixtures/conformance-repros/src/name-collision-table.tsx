import type { ReactNode } from "react";

// An unrelated component that happens to be called `Row` (wild-oasis src/ui/Table.jsx:82).
export function Row({ children }: { children: ReactNode }) {
  return <div role="row">{children}</div>;
}
