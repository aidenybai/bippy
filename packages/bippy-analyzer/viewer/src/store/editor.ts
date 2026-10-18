import { create } from "zustand";

interface EditorState {
  isEditing: boolean;
  draft: string | null;
  startEditing: () => void;
  stopEditing: () => void;
  setDraft: (draft: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  isEditing: false,
  draft: null,
  startEditing: () => set({ isEditing: true, draft: null }),
  stopEditing: () => set({ isEditing: false, draft: null }),
  setDraft: (draft) => set({ draft }),
}));

export const useIsEditing = (): boolean => useEditorStore((state) => state.isEditing);

export const useHasDraft = (): boolean => useEditorStore((state) => state.draft !== null);
