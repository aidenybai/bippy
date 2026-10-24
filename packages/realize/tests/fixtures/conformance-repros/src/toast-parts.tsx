import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface ToastManager {
  toasts: string[];
  add: (toast: string) => void;
}

const ManagerContext = createContext<ToastManager | null>(null);
const RootContext = createContext<string | null>(null);

const useToastManager = (): ToastManager => {
  const manager = useContext(ManagerContext);
  if (!manager) throw new Error("useToastManager must be used within <Toast.Provider>.");
  return manager;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<string[]>([]);
  return (
    <ManagerContext.Provider value={{ toasts, add: (toast) => setToasts([...toasts, toast]) }}>
      {children}
    </ManagerContext.Provider>
  );
};

export const Toast = ({ toast, children }: { toast: string; children: ReactNode }) => {
  useToastManager();
  return (
    <RootContext.Provider value={toast}>
      <div>{children}</div>
    </RootContext.Provider>
  );
};

export const ToastContent = ({ children }: { children?: ReactNode }) => {
  const toast = useContext(RootContext);
  const [isExpanded, setIsExpanded] = useState(false);
  if (toast === null) throw new Error("Toast parts must be used within <Toast.Root>.");
  return (
    <button type="button" onClick={() => setIsExpanded(!isExpanded)}>
      {isExpanded ? toast : "Show"}
      {children}
    </button>
  );
};
