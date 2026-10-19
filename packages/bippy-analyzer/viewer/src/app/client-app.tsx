"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/components/viewer/app";
import type { Example } from "@/model";

export const ClientApp = ({ examples }: { examples: Example[] }) => {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <App examples={examples} />
    </QueryClientProvider>
  );
};
