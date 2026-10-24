import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface PickerState {
  isPickerOpen: boolean;
  setIsPickerOpen: (isOpen: boolean) => void;
}

export const PickerContext = createContext<PickerState>({
  isPickerOpen: false,
  setIsPickerOpen: () => {},
});

export function PickerProvider({ children }: { children: ReactNode }) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  return (
    <PickerContext.Provider value={{ isPickerOpen, setIsPickerOpen }}>
      {children}
    </PickerContext.Provider>
  );
}

export const usePicker = () => useContext(PickerContext);
