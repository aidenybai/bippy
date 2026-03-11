import { type ReactNode } from "react";

interface ToolbarProps {
  children: ReactNode;
}

export const Toolbar = ({ children }: ToolbarProps) => {
  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-stretch gap-1 rounded-lg border bg-card p-1.5 shadow-lg">
      {children}
    </div>
  );
};
