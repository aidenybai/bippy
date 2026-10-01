import type { ReactNode } from "react";
import { Mirror } from "@/components/mirror";

export default function MirrorLayout({ children }: { children: ReactNode }) {
  return <Mirror>{children}</Mirror>;
}
