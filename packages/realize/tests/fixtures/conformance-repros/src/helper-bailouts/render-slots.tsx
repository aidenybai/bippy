import type { ReactNode } from "react";

export function renderSlots(renderHeader: (title: string) => ReactNode): ReactNode {
  const header = renderHeader("title");
  return <header>{header}</header>;
}
