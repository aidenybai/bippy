import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-sm px-[5px] text-[11px]/none font-medium whitespace-nowrap tabular-nums",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        secondary: "bg-muted text-muted-foreground",
        outline: "border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
);
