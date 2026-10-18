import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input
    data-slot="input"
    className={cn(
      "h-7 min-w-0 rounded-md bg-muted px-2.5 text-foreground outline-none transition-[background,box-shadow] duration-150 placeholder:text-faint focus-visible:bg-background focus-visible:shadow-focus",
      className,
    )}
    {...props}
  />
);
