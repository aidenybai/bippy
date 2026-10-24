import type { ReactNode } from "react";
import AppProviders from "/src/components/Common/Providers";

export default function Providers({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
