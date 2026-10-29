import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProviderClient } from "/locales/client";

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProviderClient locale="en">{children}</I18nProviderClient>
    </QueryClientProvider>
  );
}
