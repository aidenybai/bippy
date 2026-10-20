import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/viewer/theme-toggle";
import { cn } from "@/lib/utils";

interface StartShellProps {
  className?: string;
  children: ReactNode;
}

export const StartShell = ({ className, children }: StartShellProps) => (
  <main className="relative flex min-h-dvh flex-col px-4">
    <div className="absolute top-2 right-3">
      <ThemeToggle />
    </div>
    <div className={cn("mx-auto flex w-full max-w-md flex-col gap-4", className)}>{children}</div>
  </main>
);
