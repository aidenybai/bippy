import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@pierre/diffs/edit";
import { EditProvider, type EditorFactory } from "@pierre/diffs/react";
import { ThemeProvider } from "next-themes";
import { App } from "./app";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const createEditor: EditorFactory<undefined, undefined> = (type, options, editStateKey) =>
  new Editor(type, options, editStateKey);
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        storageKey="bippy-viewer-theme"
        enableSystem
        disableTransitionOnChange
      >
        <EditProvider createEditor={createEditor}>
          <App />
        </EditProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
