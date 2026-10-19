import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Skeleton = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="skeleton"
    aria-hidden="true"
    className={cn("animate-pulse rounded-sm bg-muted motion-reduce:animate-none", className)}
    {...props}
  />
);
