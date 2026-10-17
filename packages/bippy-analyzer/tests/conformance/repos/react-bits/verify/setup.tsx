import type { ReactNode } from "react";
import { Provider } from "/src/components/setup/provider";

export default function Providers({ children }: { children: ReactNode }) {
  return <Provider>{children}</Provider>;
}
