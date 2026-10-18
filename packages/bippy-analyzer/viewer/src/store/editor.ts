import { create } from "zustand";

interface EditorState {
  draft: string | null;
  generation: number;
  setDraft: (draft: string) => void;
  discard: () => void;
  settle: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  draft: null,
  generation: 0,
  setDraft: (draft) => set({ draft }),
  discard: () => set((state) => ({ draft: null, generation: state.generation + 1 })),
  settle: () => set({ draft: null }),
}));

export const useHasDraft = (): boolean => useEditorStore((state) => state.draft !== null);
