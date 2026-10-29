import { create } from "zustand";

interface UiState {
  isInspectorOpen: boolean;
  openedPanels: Set<string>;
  closedPanels: Set<string>;
  setInspectorOpen: (open: boolean) => void;
  choosePanel: (name: string, open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isInspectorOpen: true,
  openedPanels: new Set(),
  closedPanels: new Set(),
  setInspectorOpen: (isInspectorOpen) => set({ isInspectorOpen }),
  choosePanel: (name, open) =>
    set((state) => {
      const openedPanels = new Set(state.openedPanels);
      const closedPanels = new Set(state.closedPanels);
      if (open) {
        openedPanels.add(name);
        closedPanels.delete(name);
      } else {
        closedPanels.add(name);
        openedPanels.delete(name);
      }
      return { openedPanels, closedPanels };
    }),
}));

export const useIsPanelOpen = (name: string, activeName: string | null): boolean =>
  useUiStore(
    (state) =>
      !state.closedPanels.has(name) && (state.openedPanels.has(name) || name === activeName),
  );

export const useIsPanelChosen = (name: string): boolean =>
  useUiStore((state) => state.openedPanels.has(name) || state.closedPanels.has(name));
