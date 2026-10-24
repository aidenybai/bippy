import { create } from "zustand";

interface ConfigStore {
  darkmodeEnabled: boolean;
  rulersEnabled: boolean;
  toggleDarkMode: (value: boolean) => void;
  flipRulers: () => void;
  reset: () => void;
}

export const useConfig = create<ConfigStore>()((set) => ({
  darkmodeEnabled: true,
  rulersEnabled: false,
  toggleDarkMode: (darkmodeEnabled) => set({ darkmodeEnabled }),
  flipRulers: () => set((state) => ({ rulersEnabled: !state.rulersEnabled })),
  reset: () => {
    set({ darkmodeEnabled: true });
    set({ rulersEnabled: false });
  },
}));
