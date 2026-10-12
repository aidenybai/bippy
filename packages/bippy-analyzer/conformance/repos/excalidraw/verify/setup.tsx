import type { ReactNode } from "react";

import { EditorJotaiProvider, editorJotaiStore } from "/packages/excalidraw/editor-jotai";

/** Mounts every component in the editor's isolated Jotai store, as its root does. */
export default function Providers({ children }: { children: ReactNode }) {
  return <EditorJotaiProvider store={editorJotaiStore}>{children}</EditorJotaiProvider>;
}
