import type { ReactNode } from "react";
import { TRPCProvider } from "/src/trpc/client";

export default function Providers({ children }: { children: ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
