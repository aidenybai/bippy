import { create } from "zustand";

interface UiState {
  isInspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isInspectorOpen: true,
  setInspectorOpen: (isInspectorOpen) => set({ isInspectorOpen }),
}));
