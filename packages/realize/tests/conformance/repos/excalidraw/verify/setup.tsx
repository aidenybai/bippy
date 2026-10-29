import type { ReactNode } from "react";

import { EditorJotaiProvider, editorJotaiStore } from "/packages/excalidraw/editor-jotai";

export default function Providers({ children }: { children: ReactNode }) {
  return <EditorJotaiProvider store={editorJotaiStore}>{children}</EditorJotaiProvider>;
}
