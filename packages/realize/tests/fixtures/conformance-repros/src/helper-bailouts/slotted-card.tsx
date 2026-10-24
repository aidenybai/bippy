import type { ReactNode } from "react";
import { renderSlots } from "./render-slots";

export function SlottedCard({ renderHeader }: { renderHeader: (title: string) => ReactNode }) {
  const slots = renderSlots(renderHeader);
  return <section>{slots}</section>;
}
