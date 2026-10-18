import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { App } from "./app";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        storageKey="bippy-viewer-theme"
        enableSystem
        disableTransitionOnChange
      >
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
