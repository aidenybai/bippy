import "./globals";
import "/src/lib/jellyfin-apiclient";
import "/src/components/apphost";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return children;
}
