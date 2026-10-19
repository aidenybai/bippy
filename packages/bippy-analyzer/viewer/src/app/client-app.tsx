"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@pierre/diffs/edit";
import { EditProvider, type EditorFactory } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";

const App = dynamic(() => import("@/components/viewer/app").then((module) => module.App), {
  ssr: false,
  loading: () => <Spinner className="h-dvh" />,
});

const createEditor: EditorFactory<undefined, undefined> = (type, options, editStateKey) =>
  new Editor(type, options, editStateKey);

export const ClientApp = () => {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <EditProvider createEditor={createEditor}>
        <App />
      </EditProvider>
    </QueryClientProvider>
  );
};
