import type { ReactNode } from "react";
import { TRPCReactProvider } from "/src/lib/trpc/react";

export default function Providers({ children }: { children: ReactNode }) {
  return <TRPCReactProvider>{children}</TRPCReactProvider>;
}
